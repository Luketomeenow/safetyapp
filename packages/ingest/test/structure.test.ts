import { describe, expect, it } from "vitest";
import { detectStructure, isHeadingLike } from "../src/structure.ts";
import { parseToc } from "../src/toc.ts";
import type { PageLines } from "../src/types.ts";

const pages: PageLines[] = [
  {
    page_index: 1,
    lines: [
      "1 Alpha Program 3",
      "1.1 Scope 3",
      "1.2 Lockout Procedures for Escalators and Moving Walks 4",
      "2 Beta Gamma Program 6",
      "2.1 Definitions 6",
      "",
      "Alpha Program",
      "(Reference: Policy AXX-0001)",
      "Intro text.",
      "",
      "Scope",
      "Scope text.",
      "Lockout Procedures for Escalators and Moving",
      "Walks",
      "Procedure text.",
    ],
  },
  {
    page_index: 2,
    lines: ["More procedure text.", "Revision Tracking Table", "", "Beta Gamma", "Program", ""],
  },
  {
    page_index: 3,
    lines: ["(Reference: Policy AXX-0002)", "Beta intro.", "Definitions", "Definition text."],
  },
];

describe("detectStructure", () => {
  const toc = parseToc(pages);
  const result = detectStructure(pages, toc);

  it("locates programs by their reference lines, including a two-line title orphaned on the previous page", () => {
    expect(result.problems).toEqual([]);
    expect(result.programs.map((p) => p.number)).toEqual([1, 2]);
    expect(result.programs[0]?.start).toEqual({ page: 1, line: 7 });
    expect(result.programs[0]?.end).toEqual({ page: 2, line: 6 });
    expect(result.programs[1]?.start).toEqual({ page: 3, line: 1 });
    expect(result.programs[1]?.title_method).toBe("two_line");
    expect(result.programs[1]?.policy_ref).toBe("AXX-0002");
    expect(result.warnings.some((w) => w.includes("tail of page 2"))).toBe(true);
  });

  it("matches subsection headings in order, joining two-line headings, with line-granular spans", () => {
    const numbers = result.sections.map((s) => s.number);
    expect(numbers).toEqual(["1", "1.1", "1.2", "2", "2.1"]);
    const s12 = result.sections.find((s) => s.number === "1.2");
    expect(s12?.match_method).toBe("two_line");
    expect(s12?.start).toEqual({ page: 1, line: 13 });
    expect(s12?.end).toEqual({ page: 2, line: 6 });
    const s1 = result.sections.find((s) => s.number === "1");
    expect(s1?.end).toEqual({ page: 1, line: 10 });
    const s21 = result.sections.find((s) => s.number === "2.1");
    expect(s21?.end).toEqual({ page: 3, line: 4 });
  });

  it("reports a subsection that cannot be found and accepts an override for it", () => {
    const broken = pages.map((p) => ({
      ...p,
      lines: p.lines.map((l) => (l === "Scope" ? "Sc0pe heading" : l)),
    }));
    const missing = detectStructure(broken, toc);
    expect(missing.problems.some((p) => p.includes('subsection 1.1 "Scope" not found'))).toBe(true);
    const fixed = detectStructure(broken, toc, [{ number: "1.1", page: 1, line: 11 }]);
    expect(fixed.problems).toEqual([]);
    expect(fixed.sections.find((s) => s.number === "1.1")?.match_method).toBe("override");
    const absent = detectStructure(broken, toc, [
      { number: "1.1", absent: true, note: "Removed." },
    ]);
    expect(absent.problems).toEqual([]);
    expect(absent.sections.some((s) => s.number === "1.1")).toBe(false);
    expect(absent.warnings.some((w) => w.includes("no heading in the body"))).toBe(true);
  });
});

describe("isHeadingLike", () => {
  it("rejects sentences, bullets, table rows and reference lines", () => {
    expect(isHeadingLike("Scope")).toBe(true);
    expect(isHeadingLike("This is a sentence.")).toBe(false);
    expect(isHeadingLike("● Bullet item")).toBe(false);
    expect(isHeadingLike("| ITEM | SIZE |")).toBe(false);
    expect(isHeadingLike("(Reference: Policy AXX-0001)")).toBe(false);
  });
});
