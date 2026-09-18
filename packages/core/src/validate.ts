import { normalizeForMatch, type ResponseKind } from "@axxiom/shared";
import { type LoadedManual, lineForNormalizedOffset, resolveSection } from "./manual.ts";

export const MARKERS: Record<string, ResponseKind> = {
  "[[AXX:ANSWER]]": "answer",
  "[[AXX:NOT_COVERED]]": "not_covered",
  "[[AXX:OUT_OF_SCOPE]]": "out_of_scope",
  "[[AXX:EMERGENCY]]": "emergency",
};

/** Splits the first line off the model's text and maps it to a response kind. */
const MARKER_RE = /^\s*(\[\[AXX:(ANSWER|NOT_COVERED|OUT_OF_SCOPE|EMERGENCY)\]\])\s*/;

/** Reads the leading marker (alone on the first line or followed by text) and strips it. */
export function parseMarker(text: string): { kind: ResponseKind | null; body: string } {
  const m = MARKER_RE.exec(text);
  if (!m?.[1]) return { kind: null, body: text };
  const kind = MARKERS[m[1]] ?? null;
  return { kind, body: text.slice(m[0].length).replace(/^\s+/, "") };
}

export type ParsedQuote = {
  text: string;
  /** Each blockquote line's [...]-separated fragments; every line must be found on the same page. */
  lines: string[][];
  fragments: string[];
  sourcePage: number | null;
  sourceProgram: number | null;
  sourceSection: string | null;
};

const SOURCE_RE =
  /Source:\s*Program\s+(\d+)[^\n]*?(?:,\s*(\d+\.\d+)\b[^\n]*?)?,?\s*pages?\s+(\d+)/i;

/** Blockquotes from the "Policy text" part, each with the Source line that follows it. */
export function extractQuotes(body: string): ParsedQuote[] {
  const lines = body.split("\n");
  const quotes: ParsedQuote[] = [];
  let current: string[] = [];
  const flush = (sourceLine: string | null) => {
    if (current.length === 0) return;
    const cleaned = current
      .map((l) =>
        l
          .replace(/^\s*[\u2022\u25CF\u25CB\u25AA\u25A0\u2023\u25E6\-*]+\s*/, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter((l) => l.length > 0);
    const text = cleaned.join(" ");
    const m = sourceLine ? SOURCE_RE.exec(sourceLine) : null;
    const split = (t: string) =>
      t
        .split(/\[\s*\.\.\.\s*\]|\u2026/)
        .map((f) => f.trim())
        .filter((f) => f.length > 0);
    quotes.push({
      text,
      lines: cleaned.map(split).filter((f) => f.length > 0),
      fragments: split(text),
      sourcePage: m?.[3] ? Number(m[3]) : null,
      sourceProgram: m?.[1] ? Number(m[1]) : null,
      sourceSection: m?.[2] ?? null,
    });
    current = [];
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (/^\s*>/.test(line)) {
      current.push(line.replace(/^\s*>\s?/, ""));
      continue;
    }
    if (current.length > 0) {
      // the Source line may follow immediately or after one blank line
      const next = line.trim().length === 0 ? (lines[i + 1] ?? "") : line;
      flush(SOURCE_RE.test(next) ? next : null);
    }
  }
  flush(null);
  return quotes;
}

export type QuoteCheck = {
  quote: ParsedQuote;
  found: boolean;
  page: number | null;
  line: number | null;
  sectionId: string | null;
  sectionNumber: string | null;
};

/**
 * Each fragment of a quote must appear, in order, in the normalized text of one candidate page.
 * Candidates: the page named in the Source line, then every cited page and its neighbors.
 */
export function verifyQuote(
  manual: LoadedManual,
  quote: ParsedQuote,
  citedPages: number[],
): QuoteCheck {
  const lines = quote.lines
    .map((frags) => frags.map(normalizeForMatch).filter((f) => f.length > 0))
    .filter((f) => f.length > 0);
  if (lines.length === 0)
    return { quote, found: true, page: null, line: null, sectionId: null, sectionNumber: null };
  const preferred: number[] = [];
  if (quote.sourcePage) preferred.push(quote.sourcePage);
  for (const p of citedPages) for (const q of [p, p - 1, p + 1]) preferred.push(q);
  const all: number[] = [];
  for (let p = manual.body_start_page; p <= manual.page_count; p += 1) all.push(p);
  const order = [...new Set([...preferred, ...all])].filter(
    (p) => p >= manual.body_start_page && p <= manual.page_count,
  );
  const textOf = (p: number) => manual.normalizedPages.get(p) ?? "";
  const findLine = (haystack: string, frags: string[]): number => {
    let cursor = 0;
    let first = -1;
    for (const fragment of frags) {
      const idx = haystack.indexOf(fragment, cursor);
      if (idx === -1) return -1;
      if (first === -1) first = idx;
      cursor = idx + fragment.length;
    }
    return first;
  };
  for (const page of order) {
    const own = textOf(page);
    // A passage may run from this page onto the next one (paragraphs cross page breaks).
    const joined = page < manual.page_count ? `${own} ${textOf(page + 1)}` : own;
    const offsets = lines.map((frags) => findLine(joined, frags));
    if (offsets.some((o) => o === -1)) continue;
    const firstOffset = Math.min(...offsets);
    if (firstOffset >= own.length) continue; // the quote must start on this page
    const pageRecord = manual.pages[page - 1];
    const line = pageRecord ? lineForNormalizedOffset(pageRecord, firstOffset) : null;
    const section = resolveSection(manual, page, line ?? undefined);
    return {
      quote,
      found: true,
      page,
      line,
      sectionId: section?.id ?? null,
      sectionNumber: section?.number ?? null,
    };
  }
  return { quote, found: false, page: null, line: null, sectionId: null, sectionNumber: null };
}

export type ValidationInput = {
  kind: ResponseKind | null;
  body: string;
  citedPages: number[];
  citedTexts: Map<number, string>;
  stopReason: string | null;
};
export type ValidationResult = {
  passed: boolean;
  problems: string[];
  quotesVerified: boolean;
  checks: QuoteCheck[];
  validPages: number[];
  truncated: boolean;
};

export function validateAnswer(manual: LoadedManual, input: ValidationInput): ValidationResult {
  const problems: string[] = [];
  const truncated = input.stopReason === "max_tokens";
  if (input.kind === null) problems.push("missing or unknown response marker on the first line");
  const validPages: number[] = [];
  for (const page of input.citedPages) {
    if (page < manual.body_start_page || page > manual.page_count) {
      problems.push(`citation to non-citable page ${page}`);
      continue;
    }
    const expected = manual.pages[page - 1]?.block_text;
    const cited = input.citedTexts.get(page);
    if (
      expected !== undefined &&
      cited !== undefined &&
      normalizeForMatch(cited) !== normalizeForMatch(expected)
    ) {
      problems.push(
        `cited_text for page ${page} does not match the stored page block (stale cache?)`,
      );
      continue;
    }
    if (!validPages.includes(page)) validPages.push(page);
  }
  const quotes = input.kind === "answer" ? extractQuotes(input.body) : [];
  const checks = quotes
    .filter((q) => q.text.length >= 20)
    .map((q) => verifyQuote(manual, q, validPages));
  for (const c of checks)
    if (!c.found) problems.push(`quote not found in the manual: "${c.quote.text.slice(0, 120)}"`);
  // A verbatim quote verified on a body page is grounding evidence in its own right; the API's
  // citation blocks are welcome but the model does not always attach them to blockquotes.
  for (const c of checks)
    if (c.found && c.page && !validPages.includes(c.page)) validPages.push(c.page);
  if (input.kind === "answer") {
    if (quotes.length === 0 && !truncated) problems.push("answer has no policy text blockquote");
    if (validPages.length === 0) problems.push("answer has no verified quote or citation");
  }
  if (truncated && input.kind === "answer" && validPages.length === 0)
    problems.push("truncated before any citation");
  return {
    passed: problems.length === 0,
    problems,
    quotesVerified: checks.length > 0 && checks.every((c) => c.found),
    checks,
    validPages,
    truncated,
  };
}

export function fallbackText(
  kind: ResponseKind | null,
  validPages: number[],
  manual: LoadedManual,
): string {
  const refs = validPages
    .map((p) => {
      const s = resolveSection(manual, p);
      return s
        ? `Program ${s.program_number}${s.number && s.level === 2 ? `, ${s.number} ${s.title}` : ""}, page ${p}`
        : `page ${p}`;
    })
    .join("; ");
  if (kind === "refusal") {
    return "The assistant could not answer this request. Open the manual for the relevant program, or ask your supervisor or the Safety Manager.";
  }
  return `The assistant could not verify the policy text for this answer, so it is not shown. ${refs ? `The related pages are: ${refs}. Open them in the manual, or ` : "Open the manual, or "}ask your supervisor.`;
}
