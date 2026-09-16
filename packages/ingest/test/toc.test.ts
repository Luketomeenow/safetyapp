import { describe, expect, it } from "vitest";
import { parseToc } from "../src/toc.ts";

const pages = [
  {
    page_index: 1,
    lines: [
      "Axxiom Elevator",
      "Table of Contents",
      "1 General Safety Rules 10",
      "1.1 General Job Site Rules 10",
      "1.2 Housekeeping 10",
      "2 Job Hazard Analysis 13",
    ],
  },
  {
    page_index: 2,
    lines: [
      "2.1 Development 13",
      "",
      "General Safety Rules",
      "(Reference: Policy AXX- 0010)",
      "Body text.",
    ],
  },
];

describe("parseToc", () => {
  it("collects programs and subsections and finds where the body starts", () => {
    const toc = parseToc(pages);
    expect(toc.programs.map((p) => p.title)).toEqual([
      "General Safety Rules",
      "Job Hazard Analysis",
    ]);
    expect(toc.subsections.map((s) => s.number)).toEqual(["1.1", "1.2", "2.1"]);
    expect(toc.subsections[0]?.toc_page_hint).toBe(10);
    expect(toc.body_start_page).toBe(2);
    expect(toc.body_start_line).toBe(3);
    expect(toc.problems).toEqual([]);
  });

  it("reports numbering gaps", () => {
    const toc = parseToc([
      {
        page_index: 1,
        lines: [
          "1 Alpha 3",
          "1.1 One 3",
          "1.3 Three 4",
          "",
          "Alpha",
          "(Reference: Policy AXX-0001)",
        ],
      },
    ]);
    expect(toc.problems).toEqual(["TOC subsection numbering gap: expected 1.2, found 1.3"]);
  });

  it("throws when the table of contents never ends", () => {
    expect(() => parseToc([{ page_index: 1, lines: ["1 Alpha 3", "1.1 One 3"] }])).toThrow(
      /never ended/,
    );
  });
});
