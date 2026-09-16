import type { ProgramSpan, SectionSpan } from "./structure.ts";
import type { PageLines } from "./types.ts";

export type BlockPage = {
  page_index: number;
  is_toc: boolean;
  header: string;
  model_text: string;
  block_text: string;
  section_numbers: string[];
};

const MAX_HEADER_SECTIONS = 8;

/**
 * One block per PDF page. TOC pages become a one-line placeholder; body pages get a deterministic
 * header naming the PDF page, the program(s) and the subsections present, then the page text.
 */
export function buildBlocks(
  pages: PageLines[],
  toc: { body_start_page: number; body_start_line: number },
  programs: ProgramSpan[],
  sections: SectionSpan[],
): BlockPage[] {
  const total = pages.length;
  return pages.map((page) => {
    const p = page.page_index;
    if (p < toc.body_start_page) {
      const header = `[Page ${p} of ${total} | Table of contents. Its page numbers do not match PDF pages. Not citable.]`;
      return {
        page_index: p,
        is_toc: true,
        header,
        model_text: page.lines.join("\n"),
        block_text: header,
        section_numbers: [],
      };
    }
    const lines =
      p === toc.body_start_page ? page.lines.slice(toc.body_start_line - 1) : page.lines;
    const onPage = (s: { start: { page: number }; end: { page: number } }) =>
      s.start.page <= p && s.end.page >= p;
    const programLabel =
      programs
        .filter(onPage)
        .map((pr) => `Program ${pr.number}: ${pr.title}`)
        .join(" / ") || "Program unknown";
    const level2 = sections.filter((s) => s.level === 2 && onPage(s));
    const named = (
      level2.length > 0 ? level2 : sections.filter((s) => s.level === 1 && onPage(s))
    ).map((s) => (s.number ? `${s.number} ${s.title}` : s.title));
    const shown =
      named.length > MAX_HEADER_SECTIONS
        ? [...named.slice(0, MAX_HEADER_SECTIONS), `+${named.length - MAX_HEADER_SECTIONS} more`]
        : named;
    const header = `[Page ${p} of ${total} | ${programLabel} | ${shown.join("; ")}]`;
    const modelText = lines.join("\n").trim();
    return {
      page_index: p,
      is_toc: false,
      header,
      model_text: modelText,
      block_text: `${header}\n\n${modelText}`.trim(),
      section_numbers: sections
        .filter((s) => s.level === 2 && onPage(s))
        .map((s) => s.number ?? s.title),
    };
  });
}
