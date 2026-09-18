import { normalizeForMatch, type ResponseKind } from "@axxiom/shared";
import { type LoadedManual, lineForNormalizedOffset, resolveSection } from "./manual.ts";

export const MARKERS: Record<string, ResponseKind> = {
  "[[AXX:ANSWER]]": "answer",
  "[[AXX:NOT_COVERED]]": "not_covered",
  "[[AXX:OUT_OF_SCOPE]]": "out_of_scope",
  "[[AXX:EMERGENCY]]": "emergency",
};

/** Splits the first line off the model's text and maps it to a response kind. */
export function parseMarker(text: string): { kind: ResponseKind | null; body: string } {
  const trimmed = text.replace(/^\s+/, "");
  const newline = trimmed.indexOf("\n");
  const first = (newline === -1 ? trimmed : trimmed.slice(0, newline)).trim();
  const kind = MARKERS[first] ?? null;
  if (!kind) return { kind: null, body: text };
  return { kind, body: newline === -1 ? "" : trimmed.slice(newline + 1).replace(/^\s+/, "") };
}

export type ParsedQuote = {
  text: string;
  fragments: string[];
  sourcePage: number | null;
  sourceProgram: number | null;
  sourceSection: string | null;
};

const SOURCE_RE = /Source:\s*Program\s+(\d+)[^\n]*?(?:,\s*(\d+\.\d+)\b[^\n]*?)?,\s*page\s+(\d+)/i;

/** Blockquotes from the "Policy text" part, each with the Source line that follows it. */
export function extractQuotes(body: string): ParsedQuote[] {
  const lines = body.split("\n");
  const quotes: ParsedQuote[] = [];
  let current: string[] = [];
  const flush = (sourceLine: string | null) => {
    if (current.length === 0) return;
    const text = current.join(" ").replace(/\s+/g, " ").trim();
    const m = sourceLine ? SOURCE_RE.exec(sourceLine) : null;
    quotes.push({
      text,
      fragments: text
        .split(/\[\s*\.\.\.\s*\]|…/)
        .map((f) => f.trim())
        .filter((f) => f.length > 0),
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
  const candidates = new Set<number>();
  if (quote.sourcePage) candidates.add(quote.sourcePage);
  for (const p of citedPages) for (const q of [p, p - 1, p + 1]) candidates.add(q);
  const fragments = quote.fragments.map(normalizeForMatch).filter((f) => f.length > 0);
  if (fragments.length === 0)
    return { quote, found: true, page: null, line: null, sectionId: null, sectionNumber: null };
  for (const page of candidates) {
    if (page < manual.body_start_page || page > manual.page_count) continue;
    const text = manual.normalizedPages.get(page);
    if (!text) continue;
    let cursor = 0;
    let firstOffset = -1;
    let ok = true;
    for (const fragment of fragments) {
      const idx = text.indexOf(fragment, cursor);
      if (idx === -1) {
        ok = false;
        break;
      }
      if (firstOffset === -1) firstOffset = idx;
      cursor = idx + fragment.length;
    }
    if (ok) {
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
    if (!c.found) problems.push(`quote not found in the manual: "${c.quote.text.slice(0, 80)}"`);
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
