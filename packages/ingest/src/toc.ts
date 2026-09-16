import type { PageLines } from "./types.ts";

export type TocEntry = {
  number: string;
  level: 1 | 2;
  program_number: number;
  title: string;
  toc_page_hint: number;
  toc_page: number;
  toc_line: number;
};

export type TocResult = {
  entries: TocEntry[];
  programs: TocEntry[];
  subsections: TocEntry[];
  body_start_page: number;
  body_start_line: number;
  problems: string[];
};

/** "8 Lockout/Tagout/Tryout Program 42" or "8.6 De-energizing Procedure 45". */
const ENTRY_RE = /^(\d{1,2})(?:\.(\d{1,2}))?\s+(\S.*?)\s+(\d{1,3})$/;

/**
 * Parses the table of contents from the start of the document. Entries are recognized by
 * "<number> <title> <page>" lines; the body begins at the first non-blank line after the entries
 * that is not an entry. TOC page numbers are kept only as hints (they do not match PDF pages).
 */
export function parseToc(pages: PageLines[]): TocResult {
  const entries: TocEntry[] = [];
  let seenEntry = false;
  for (const page of pages) {
    for (let i = 0; i < page.lines.length; i += 1) {
      const line = (page.lines[i] ?? "").trim();
      if (line.length === 0) continue;
      const m = ENTRY_RE.exec(line);
      if (m) {
        const major = Number(m[1]);
        const minor = m[2];
        entries.push({
          number: minor === undefined ? String(major) : `${major}.${Number(minor)}`,
          level: minor === undefined ? 1 : 2,
          program_number: major,
          title: (m[3] ?? "").trim(),
          toc_page_hint: Number(m[4]),
          toc_page: page.page_index,
          toc_line: i + 1,
        });
        seenEntry = true;
        continue;
      }
      if (seenEntry) return finalize(entries, page.page_index, i + 1);
    }
  }
  throw new Error("Table of contents never ended: no body text found after the last entry");
}

function finalize(entries: TocEntry[], bodyPage: number, bodyLine: number): TocResult {
  const problems: string[] = [];
  const programs = entries.filter((e) => e.level === 1);
  const subsections = entries.filter((e) => e.level === 2);
  programs.forEach((p, idx) => {
    if (p.program_number !== idx + 1) {
      problems.push(`TOC program numbering gap: expected ${idx + 1}, found ${p.number}`);
    }
  });
  for (const p of programs) {
    const subs = subsections.filter((s) => s.program_number === p.program_number);
    subs.forEach((s, j) => {
      const expected = `${p.program_number}.${j + 1}`;
      if (s.number !== expected) {
        problems.push(`TOC subsection numbering gap: expected ${expected}, found ${s.number}`);
      }
    });
  }
  return {
    entries,
    programs,
    subsections,
    body_start_page: bodyPage,
    body_start_line: bodyLine,
    problems,
  };
}
