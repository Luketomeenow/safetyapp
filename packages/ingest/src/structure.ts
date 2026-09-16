import { diceCoefficient, normalizeHeading } from "@axxiom/shared";
import type { TocEntry, TocResult } from "./toc.ts";
import {
  comparePos,
  lastPos,
  lineAt,
  nextPos,
  type PageLines,
  type Pos,
  prevPos,
} from "./types.ts";

export type MatchMethod = "exact" | "two_line" | "list_numbered" | "fuzzy" | "override";
/** Manual fix for one TOC subsection: where its heading is, or that the body has no such heading. */
export type Override = {
  number: string;
  page?: number;
  line?: number;
  absent?: boolean;
  note?: string;
};

export type ProgramSpan = {
  number: number;
  title: string;
  policy_ref: string | null;
  start: Pos;
  ref: Pos;
  end: Pos;
  title_method: MatchMethod;
  title_score: number;
};

export type SectionSpan = {
  number: string | null;
  level: 1 | 2 | 3;
  title: string;
  program_number: number;
  start: Pos;
  end: Pos;
  match_method: MatchMethod;
  match_score: number;
  toc_page_hint: number | null;
};

export type StructureResult = {
  programs: ProgramSpan[];
  sections: SectionSpan[];
  problems: string[];
  warnings: string[];
};

const REF_RE = /^\(Reference:\s*Policy\s+(AXX-\s?\d{4})\)\s*$/;
const BULLET_RE = /^[•●○▪■‣◦]/;
const LIST_NUMBER_RE = /^\d+[.)]\s+/;

export function isReferenceLine(line: string): boolean {
  return REF_RE.test(line.trim());
}

/** Short, unpunctuated, not a bullet: a plausible heading line. */
export function isHeadingLike(line: string): boolean {
  const t = line.trim();
  if (t.length < 2 || t.length > 90) return false;
  if (/[.,;:]$/.test(t)) return false;
  if (BULLET_RE.test(t)) return false;
  if (t.startsWith("|")) return false;
  if (REF_RE.test(t)) return false;
  return true;
}

type TitleLine = { text: string; pos: Pos };

/**
 * The contiguous non-blank lines immediately above a Reference line (skipping blank lines first).
 * Stays on the page where the first non-blank line was found, so a title orphaned at the tail of
 * the previous page is collected without dragging in that page's body text.
 */
function collectTitleLines(pages: PageLines[], refPos: Pos): TitleLine[] {
  let p = prevPos(pages, refPos);
  while (p && lineAt(pages, p).trim().length === 0) p = prevPos(pages, p);
  if (!p) return [];
  const page = p.page;
  const out: TitleLine[] = [];
  while (p && p.page === page && out.length < 3 && lineAt(pages, p).trim().length > 0) {
    out.unshift({ text: lineAt(pages, p), pos: p });
    p = prevPos(pages, p);
  }
  return out;
}

type TitleMatch = { method: MatchMethod; score: number; lines: number };

function matchTitle(lines: TitleLine[], expectedTitle: string): TitleMatch | null {
  const target = normalizeHeading(expectedTitle);
  for (let n = 1; n <= lines.length; n += 1) {
    const joined = lines
      .slice(lines.length - n)
      .map((l) => l.text)
      .join(" ");
    if (normalizeHeading(joined) === target)
      return { method: n === 1 ? "exact" : "two_line", score: 1, lines: n };
  }
  let best: TitleMatch | null = null;
  for (let n = 1; n <= lines.length; n += 1) {
    const joined = lines
      .slice(lines.length - n)
      .map((l) => l.text)
      .join(" ");
    const score = diceCoefficient(normalizeHeading(joined), target);
    if (score >= 0.8 && (!best || score > best.score)) best = { method: "fuzzy", score, lines: n };
  }
  return best;
}

type HeadingHit = { pos: Pos; method: MatchMethod; score: number; lineCount: number };

function scanHeadings(
  pages: PageLines[],
  from: Pos,
  to: Pos,
  test: (
    line: string,
    next: string,
  ) => { method: MatchMethod; score: number; lineCount: number } | null,
): HeadingHit | null {
  let pos: Pos | null = from;
  while (pos && comparePos(pos, to) <= 0) {
    const line = lineAt(pages, pos);
    if (line.trim().length > 0 && isHeadingLike(line)) {
      const np = nextPos(pages, pos);
      const next = np && np.page === pos.page ? lineAt(pages, np) : "";
      const hit = test(line, next);
      if (hit) return { pos, ...hit };
    }
    pos = nextPos(pages, pos);
  }
  return null;
}

function findSubsectionHeading(
  pages: PageLines[],
  from: Pos,
  to: Pos,
  title: string,
): HeadingHit | null {
  const target = normalizeHeading(title);
  const strict = scanHeadings(pages, from, to, (line, next) => {
    if (normalizeHeading(line) === target) {
      return {
        method: LIST_NUMBER_RE.test(line.trim()) ? "list_numbered" : "exact",
        score: 1,
        lineCount: 1,
      };
    }
    if (
      next.trim().length > 0 &&
      isHeadingLike(next) &&
      normalizeHeading(`${line} ${next}`) === target
    ) {
      return { method: "two_line", score: 1, lineCount: 2 };
    }
    return null;
  });
  if (strict) return strict;
  return scanHeadings(pages, from, to, (line) => {
    const candidate = normalizeHeading(line);
    if (Math.abs(candidate.length - target.length) > Math.max(6, target.length * 0.4)) return null;
    const score = diceCoefficient(candidate, target);
    return score >= 0.85 ? { method: "fuzzy", score, lineCount: 1 } : null;
  });
}

function findReferenceLines(pages: PageLines[], toc: TocResult): { pos: Pos; ref: string }[] {
  const refs: { pos: Pos; ref: string }[] = [];
  for (const page of pages) {
    if (page.page_index < toc.body_start_page) continue;
    page.lines.forEach((line, i) => {
      if (page.page_index === toc.body_start_page && i + 1 < toc.body_start_line) return;
      const m = REF_RE.exec(line.trim());
      if (m?.[1])
        refs.push({ pos: { page: page.page_index, line: i + 1 }, ref: m[1].replace(/\s+/g, "") });
    });
  }
  return refs;
}

/**
 * Locates every program (by its "(Reference: Policy AXX-####)" line and the title above it) and
 * every TOC subsection heading inside its program, then derives line-granular section spans.
 */
export function detectStructure(
  pages: PageLines[],
  toc: TocResult,
  overrides: Override[] = [],
): StructureResult {
  const problems: string[] = [];
  const warnings: string[] = [];
  const refs = findReferenceLines(pages, toc);
  if (refs.length !== toc.programs.length) {
    problems.push(
      `Found ${refs.length} policy reference lines but the TOC lists ${toc.programs.length} programs`,
    );
  }

  const programs: ProgramSpan[] = [];
  const unmatchedPrograms = new Set(toc.programs.map((p) => p.program_number));
  refs.forEach((ref, k) => {
    const titleLines = collectTitleLines(pages, ref.pos);
    let expected: TocEntry | undefined = toc.programs[k];
    let match = expected ? matchTitle(titleLines, expected.title) : null;
    if (!match) {
      // Fall back to any program not yet placed, in case the document order differs from the TOC.
      for (const candidate of toc.programs) {
        if (!unmatchedPrograms.has(candidate.program_number)) continue;
        const m = matchTitle(titleLines, candidate.title);
        if (m) {
          if (expected && candidate.program_number !== expected.program_number) {
            warnings.push(
              `Program order differs from TOC near page ${ref.pos.page}: found ${candidate.number} where ${expected.number} was expected`,
            );
          }
          expected = candidate;
          match = m;
          break;
        }
      }
    }
    if (!expected || !match) {
      problems.push(
        `No program title matched near the reference line at page ${ref.pos.page} line ${ref.pos.line} (saw: ${titleLines.map((l) => JSON.stringify(l.text)).join(" | ")})`,
      );
      return;
    }
    unmatchedPrograms.delete(expected.program_number);
    const used = titleLines.slice(titleLines.length - match.lines);
    const firstTitle = used[0];
    const start: Pos =
      firstTitle && firstTitle.pos.page === ref.pos.page
        ? firstTitle.pos
        : { page: ref.pos.page, line: 1 };
    if (firstTitle && firstTitle.pos.page !== ref.pos.page) {
      warnings.push(
        `Program ${expected.number} title sits at the tail of page ${firstTitle.pos.page}; program starts on page ${ref.pos.page}`,
      );
    }
    programs.push({
      number: expected.program_number,
      title: expected.title,
      policy_ref: ref.ref,
      start,
      ref: ref.pos,
      end: lastPos(pages),
      title_method: match.method,
      title_score: match.score,
    });
  });
  for (const missing of unmatchedPrograms)
    problems.push(`Program ${missing} was never located in the body`);

  programs.sort((a, b) => comparePos(a.start, b.start));
  programs.forEach((program, i) => {
    const next = programs[i + 1];
    program.end = next ? (prevPos(pages, next.start) ?? next.start) : lastPos(pages);
  });

  const sections: SectionSpan[] = [];
  for (const program of programs) {
    const subs = toc.subsections.filter((s) => s.program_number === program.number);
    let cursor: Pos | null = nextPos(pages, program.ref);
    const found: SectionSpan[] = [];
    for (const sub of subs) {
      let hit: HeadingHit | null = cursor
        ? findSubsectionHeading(pages, cursor, program.end, sub.title)
        : null;
      const override = overrides.find((o) => o.number === sub.number);
      if (!hit && override?.absent) {
        warnings.push(
          `Program ${program.number}: subsection ${sub.number} "${sub.title}" is listed in the TOC but has no heading in the body (override: absent).${override.note ? ` ${override.note}` : ""}`,
        );
        continue;
      }
      if (!hit && override?.page !== undefined && override.line !== undefined) {
        hit = {
          pos: { page: override.page, line: override.line },
          method: "override",
          score: 1,
          lineCount: 1,
        };
      }
      if (!hit) {
        problems.push(
          `Program ${program.number}: subsection ${sub.number} "${sub.title}" not found between page ${cursor?.page ?? "?"} and page ${program.end.page}`,
        );
        continue;
      }
      found.push({
        number: sub.number,
        level: 2,
        title: sub.title,
        program_number: program.number,
        start: hit.pos,
        end: hit.pos,
        match_method: hit.method,
        match_score: hit.score,
        toc_page_hint: sub.toc_page_hint,
      });
      let after: Pos | null = hit.pos;
      for (let n = 0; n < hit.lineCount && after; n += 1) after = nextPos(pages, after);
      cursor = after;
    }
    sections.push({
      number: String(program.number),
      level: 1,
      title: program.title,
      program_number: program.number,
      start: program.start,
      end: program.start,
      match_method: program.title_method,
      match_score: program.title_score,
      toc_page_hint:
        toc.programs.find((p) => p.program_number === program.number)?.toc_page_hint ?? null,
    });
    sections.push(...found);
  }

  sections.sort((a, b) => comparePos(a.start, b.start));
  sections.forEach((section, i) => {
    const next = sections[i + 1];
    const program = programs.find((p) => p.number === section.program_number);
    const programEnd = program?.end ?? lastPos(pages);
    const candidate = next ? (prevPos(pages, next.start) ?? next.start) : programEnd;
    section.end = comparePos(candidate, programEnd) <= 0 ? candidate : programEnd;
    if (comparePos(section.end, section.start) < 0) section.end = section.start;
  });

  for (let i = 1; i < sections.length; i += 1) {
    const prev = sections[i - 1];
    const cur = sections[i];
    if (prev && cur && comparePos(prev.start, cur.start) === 0) {
      problems.push(
        `Sections ${prev.number ?? prev.title} and ${cur.number ?? cur.title} start on the same line (page ${cur.start.page})`,
      );
    }
  }

  const covered = new Set<number>();
  for (const s of sections) for (let p = s.start.page; p <= s.end.page; p += 1) covered.add(p);
  for (let p = toc.body_start_page; p <= pages.length; p += 1) {
    if (!covered.has(p)) problems.push(`Body page ${p} is not covered by any section`);
  }

  return { programs, sections, problems, warnings };
}
