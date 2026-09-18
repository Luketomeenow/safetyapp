import { normalizeForMatch } from "@axxiom/shared";
import type postgres from "postgres";

export type ManualPage = {
  page_index: number;
  is_toc: boolean;
  block_text: string;
  model_text: string;
};
export type ManualSection = {
  id: string;
  number: string | null;
  level: number;
  title: string;
  program_number: number;
  start_page: number;
  start_line: number;
  end_page: number;
  end_line: number;
};
export type ManualProgram = { number: number; title: string; start_page: number; end_page: number };
export type LoadedManual = {
  version_id: string;
  effective_date: string;
  page_count: number;
  body_start_page: number;
  pages: ManualPage[];
  sections: ManualSection[];
  programs: ManualProgram[];
  /** normalizeForMatch(model_text) per page, computed once. */
  normalizedPages: Map<number, string>;
};

let cached: LoadedManual | null = null;

/** Loads the active manual version once per process (warm serverless invocations reuse it). */
export async function loadActiveManual(
  sql: postgres.Sql,
  opts: { refresh?: boolean } = {},
): Promise<LoadedManual> {
  const [active] = await sql<
    { id: string; effective_date: string; page_count: number; body_start_page: number }[]
  >`
    select id, to_char(effective_date, 'YYYY-MM-DD') as effective_date, page_count, body_start_page
    from manual_versions where status = 'active' order by activated_at desc limit 1`;
  if (!active) throw new ManualUnavailableError("No active manual version");
  if (cached && cached.version_id === active.id && !opts.refresh) return cached;
  const pages = await sql<ManualPage[]>`
    select page_index, is_toc, block_text, model_text from manual_pages
    where manual_version_id = ${active.id} order by page_index`;
  const sections = await sql<ManualSection[]>`
    select id, number, level, title, program_number, start_page, start_line, end_page, end_line
    from manual_sections where manual_version_id = ${active.id} order by start_page, start_line`;
  const programs: ManualProgram[] = sections
    .filter((s) => s.level === 1)
    .map((s) => ({
      number: s.program_number,
      title: s.title,
      start_page: s.start_page,
      end_page: s.end_page,
    }));
  // A program's level-1 span only covers its intro; extend to the last line of its subsections.
  for (const p of programs) {
    const own = sections.filter((s) => s.program_number === p.number);
    p.end_page = Math.max(...own.map((s) => s.end_page));
  }
  cached = {
    version_id: active.id,
    effective_date: active.effective_date,
    page_count: active.page_count,
    body_start_page: active.body_start_page,
    pages,
    sections,
    programs,
    normalizedPages: new Map(pages.map((p) => [p.page_index, normalizeForMatch(p.model_text)])),
  };
  return cached;
}

export class ManualUnavailableError extends Error {}

export function programForPage(manual: LoadedManual, page: number): ManualProgram | null {
  return manual.programs.find((p) => p.start_page <= page && p.end_page >= page) ?? null;
}

/** Sections (level 2 preferred) that touch a page; optionally narrowed to a line on that page. */
export function resolveSection(
  manual: LoadedManual,
  page: number,
  line?: number,
): ManualSection | null {
  const onPage = manual.sections.filter((s) => s.start_page <= page && s.end_page >= page);
  const covering = (s: ManualSection) => {
    if (line === undefined) return true;
    const afterStart = s.start_page < page || s.start_line <= line;
    const beforeEnd = s.end_page > page || s.end_line >= line;
    return afterStart && beforeEnd;
  };
  const level2 = onPage.filter((s) => s.level === 2 && covering(s));
  if (level2.length > 0) return level2[level2.length - 1] ?? null;
  const level1 = onPage.filter((s) => s.level === 1 && covering(s));
  if (level1.length > 0) return level1[0] ?? null;
  return onPage.find((s) => s.level === 2) ?? onPage[0] ?? null;
}

/** Maps a character offset in the normalized page text back to a 1-based line of model_text. */
export function lineForNormalizedOffset(page: ManualPage, offset: number): number {
  const lines = page.model_text.split("\n");
  let consumed = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const n = normalizeForMatch(lines[i] ?? "");
    if (n.length === 0) continue;
    const end = consumed + n.length + 1; // +1 for the joining space
    if (offset < end) return i + 1;
    consumed = end;
  }
  return lines.length;
}
