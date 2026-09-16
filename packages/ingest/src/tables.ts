import { normalizeForMatch } from "@axxiom/shared";
import type { PageLines } from "./types.ts";

/** Registry entry describing one table that pdftotext flattened to one cell per line. */
export type TableSpec = {
  id: string;
  page: number;
  header: string[];
  /** Pages the table continues on, in order. */
  continues_on?: number[];
  /** The table ends at the first line (after the header) that starts with this text. */
  end_before?: string;
  /** Kept above the table in the page text; documented here for the review report. */
  caption?: string;
  /** Pad an incomplete final row instead of failing. */
  allow_ragged?: boolean;
  /**
   * Explicit rows, for tables whose empty cells the text layer dropped (so cells cannot be
   * re-chunked). Lines from the header to `end_before` are still consumed and replaced.
   */
  rows?: string[][];
};

export type ConsumedRange = { page: number; from: number; to: number };

export type TableResult = {
  id: string;
  pages: number[];
  header: string[];
  rows: string[][];
  markdown: string;
  consumed: ConsumedRange[];
};

export type TableCandidate = { page: number; from: number; to: number; sample: string[] };

function cellsEqual(a: string, b: string): boolean {
  return normalizeForMatch(a) === normalizeForMatch(b);
}

function findHeader(lines: string[], header: string[]): number {
  outer: for (let i = 0; i + header.length <= lines.length; i += 1) {
    for (let j = 0; j < header.length; j += 1) {
      if (!cellsEqual(lines[i + j] ?? "", header[j] ?? "")) continue outer;
    }
    return i;
  }
  return -1;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").trim();
}

export function toMarkdownTable(header: string[], rows: string[][]): string {
  const head = `| ${header.map(escapeCell).join(" | ")} |`;
  const rule = `| ${header.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`);
  return [head, rule, ...body].join("\n");
}

/** Rebuilds every registered table; a registered table that cannot be found or has ragged rows is a problem. */
export function reconstructTables(
  pages: PageLines[],
  specs: TableSpec[],
): { tables: TableResult[]; problems: string[] } {
  const tables: TableResult[] = [];
  const problems: string[] = [];
  for (const spec of specs) {
    const first = pages[spec.page - 1];
    if (!first) {
      problems.push(`Table ${spec.id}: page ${spec.page} does not exist`);
      continue;
    }
    const headerIndex = findHeader(first.lines, spec.header);
    if (headerIndex < 0) {
      problems.push(
        `Table ${spec.id}: header ${JSON.stringify(spec.header)} not found on page ${spec.page}`,
      );
      continue;
    }
    const stopPrefix = spec.end_before ? normalizeForMatch(spec.end_before) : null;
    const cells: string[] = [];
    const consumed: ConsumedRange[] = [];
    const pageOrder = [spec.page, ...(spec.continues_on ?? [])];
    let stopped = false;
    for (const [k, pageNumber] of pageOrder.entries()) {
      const page = pages[pageNumber - 1];
      if (!page) {
        problems.push(`Table ${spec.id}: continuation page ${pageNumber} does not exist`);
        break;
      }
      const startIndex = k === 0 ? headerIndex + spec.header.length : 0;
      const from = k === 0 ? headerIndex : 0;
      let last = k === 0 ? headerIndex + spec.header.length - 1 : -1;
      for (let i = startIndex; i < page.lines.length; i += 1) {
        const line = (page.lines[i] ?? "").trim();
        if (line.length === 0) continue;
        if (stopPrefix && normalizeForMatch(line).startsWith(stopPrefix)) {
          stopped = true;
          break;
        }
        cells.push(line);
        last = i;
      }
      if (last >= from) consumed.push({ page: pageNumber, from: from + 1, to: last + 1 });
      if (stopped) break;
    }
    if (stopPrefix && !stopped) {
      problems.push(`Table ${spec.id}: end marker ${JSON.stringify(spec.end_before)} never found`);
    }
    const width = spec.header.length;
    let rows: string[][];
    if (spec.rows) {
      const wrong = spec.rows.find((r) => r.length !== width);
      if (wrong) {
        problems.push(
          `Table ${spec.id}: explicit row ${JSON.stringify(wrong)} does not have ${width} cells`,
        );
        continue;
      }
      rows = spec.rows;
    } else {
      if (cells.length % width !== 0) {
        if (spec.allow_ragged) {
          while (cells.length % width !== 0) cells.push("");
        } else {
          problems.push(
            `Table ${spec.id}: ${cells.length} cells do not fill rows of ${width} (last cell: ${JSON.stringify(cells[cells.length - 1] ?? "")})`,
          );
          continue;
        }
      }
      rows = [];
      for (let i = 0; i < cells.length; i += width) rows.push(cells.slice(i, i + width));
    }
    tables.push({
      id: spec.id,
      pages: consumed.map((c) => c.page),
      header: spec.header,
      rows,
      markdown: toMarkdownTable(spec.header, rows),
      consumed,
    });
  }
  return { tables, problems };
}

/**
 * Replaces the flattened cell lines with the Markdown table. A table that spans pages is written
 * in full on every page it touches so each page block stays self-contained for citations.
 */
export function applyTables(pages: PageLines[], tables: TableResult[]): PageLines[] {
  const result = pages.map((p) => ({ page_index: p.page_index, lines: [...p.lines] }));
  const edits = new Map<number, { from: number; to: number; replacement: string[] }[]>();
  for (const table of tables) {
    const multi = table.pages.length > 1;
    const firstPage = table.pages[0];
    const lastPage = table.pages[table.pages.length - 1];
    for (const range of table.consumed) {
      const note = multi
        ? range.page === firstPage
          ? [`_Table continues on page ${lastPage}; shown here in full._`]
          : [`_Table continued from page ${firstPage}; shown here in full._`]
        : [];
      const replacement = [...note, ...table.markdown.split("\n")];
      const list = edits.get(range.page) ?? [];
      list.push({ from: range.from, to: range.to, replacement });
      edits.set(range.page, list);
    }
  }
  for (const [pageNumber, list] of edits) {
    const page = result[pageNumber - 1];
    if (!page) continue;
    list.sort((a, b) => b.from - a.from);
    for (const edit of list) {
      page.lines.splice(edit.from - 1, edit.to - edit.from + 1, ...edit.replacement);
    }
  }
  return result;
}

/** Runs of short consecutive lines that look like flattened table cells and are not covered by the registry. */
export function detectTableCandidates(
  pages: PageLines[],
  covered: ConsumedRange[],
  options: { fromPage: number; minRun?: number; maxLength?: number },
): TableCandidate[] {
  const minRun = options.minRun ?? 6;
  const maxLength = options.maxLength ?? 25;
  const isCovered = (page: number, line: number) =>
    covered.some((c) => c.page === page && line >= c.from && line <= c.to);
  const candidates: TableCandidate[] = [];
  for (const page of pages) {
    if (page.page_index < options.fromPage) continue;
    let runStart = -1;
    const flush = (endIndex: number) => {
      if (runStart >= 0 && endIndex - runStart >= minRun) {
        candidates.push({
          page: page.page_index,
          from: runStart + 1,
          to: endIndex,
          sample: page.lines.slice(runStart, Math.min(endIndex, runStart + 6)),
        });
      }
      runStart = -1;
    };
    page.lines.forEach((line, i) => {
      const t = line.trim();
      const cellLike =
        t.length > 0 &&
        t.length <= maxLength &&
        !t.startsWith("|") &&
        !/^[•●○▪■]/.test(t) &&
        !isCovered(page.page_index, i + 1);
      if (cellLike) {
        if (runStart < 0) runStart = i;
      } else {
        flush(i);
      }
    });
    flush(page.lines.length);
  }
  return candidates;
}
