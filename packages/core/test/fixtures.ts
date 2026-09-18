import { normalizeForMatch } from "@axxiom/shared";
import type { LoadedManual } from "../src/manual.ts";

/** A tiny three-page manual: page 1 is a TOC placeholder, pages 2 and 3 are Program 8. */
export function fixtureManual(): LoadedManual {
  const pages = [
    {
      page_index: 1,
      is_toc: true,
      model_text: "",
      block_text: "[Page 1 of 3 | Table of contents. Not citable.]",
    },
    {
      page_index: 2,
      is_toc: false,
      model_text:
        "Lockout/Tagout/Tryout Program\n(Reference: Policy AXX-0018)\nIntro text.\nLocking and Tagging Circuits\nIf the energy source has a lockout point, always use locks over tags. Only when an energy source\ndoes not have a lockout point, should a tag be used as the Company does not believe that tags\nare as secure as locks.",
      block_text: "",
    },
    {
      page_index: 3,
      is_toc: false,
      model_text:
        "Lockout/Tagout Devices\nAll Lockout/Tagout devices must be:\n● Capable of withstanding the environment to which they are exposed for the maximum\nperiod that exposure is expected.",
      block_text: "",
    },
  ].map((p) => ({
    ...p,
    block_text:
      p.block_text ||
      `[Page ${p.page_index} of 3 | Program 8: Lockout/Tagout/Tryout Program | 8.4 Locking and Tagging Circuits]\n\n${p.model_text}`,
  }));
  const sections = [
    {
      id: "s8",
      number: "8",
      level: 1,
      title: "Lockout/Tagout/Tryout Program",
      program_number: 8,
      start_page: 2,
      start_line: 1,
      end_page: 2,
      end_line: 3,
    },
    {
      id: "s84",
      number: "8.4",
      level: 2,
      title: "Locking and Tagging Circuits",
      program_number: 8,
      start_page: 2,
      start_line: 4,
      end_page: 2,
      end_line: 7,
    },
    {
      id: "s85",
      number: "8.5",
      level: 2,
      title: "Lockout/Tagout Devices",
      program_number: 8,
      start_page: 3,
      start_line: 1,
      end_page: 3,
      end_line: 4,
    },
  ];
  return {
    version_id: "test-v1",
    effective_date: "2026-09-01",
    page_count: 3,
    body_start_page: 2,
    pages,
    sections,
    programs: [{ number: 8, title: "Lockout/Tagout/Tryout Program", start_page: 2, end_page: 3 }],
    normalizedPages: new Map(pages.map((p) => [p.page_index, normalizeForMatch(p.model_text)])),
  };
}
