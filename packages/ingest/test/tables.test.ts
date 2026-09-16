import { describe, expect, it } from "vitest";
import { applyTables, detectTableCandidates, reconstructTables } from "../src/tables.ts";
import type { PageLines } from "../src/types.ts";

const pages: PageLines[] = [
  { page_index: 1, lines: ["Caption", "Nominal Voltage", "(a)", "(b)", "0-150", ""] },
  {
    page_index: 2,
    lines: [
      "3 (1)",
      "3",
      "151-600",
      "3.5",
      "4",
      "1. The minimum clear distance may be 2 feet",
      "Other text",
    ],
  },
];
const spec = {
  id: "clearances",
  page: 1,
  header: ["Nominal Voltage", "(a)", "(b)"],
  continues_on: [2],
  end_before: "1. The minimum clear distance",
};

describe("reconstructTables", () => {
  it("rebuilds rows across a page break and stops at the end marker", () => {
    const { tables, problems } = reconstructTables(pages, [spec]);
    expect(problems).toEqual([]);
    expect(tables[0]?.rows).toEqual([
      ["0-150", "3 (1)", "3"],
      ["151-600", "3.5", "4"],
    ]);
    expect(tables[0]?.consumed).toEqual([
      { page: 1, from: 2, to: 5 },
      { page: 2, from: 1, to: 5 },
    ]);
    expect(tables[0]?.markdown.split("\n")[0]).toBe("| Nominal Voltage | (a) | (b) |");
  });

  it("flags a ragged table and a missing header", () => {
    const ragged = reconstructTables(
      [{ page_index: 1, lines: ["A", "B", "1", "2", "3"] }],
      [{ id: "r", page: 1, header: ["A", "B"] }],
    );
    expect(ragged.problems[0]).toMatch(/do not fill rows/);
    const missing = reconstructTables(pages, [{ id: "m", page: 1, header: ["Nope"] }]);
    expect(missing.problems[0]).toMatch(/header .* not found/);
  });
});

describe("applyTables", () => {
  it("writes the full table on every page it spans and keeps surrounding text", () => {
    const { tables } = reconstructTables(pages, [spec]);
    const applied = applyTables(pages, tables);
    expect(applied[0]?.lines[0]).toBe("Caption");
    expect(applied[0]?.lines.filter((l) => l.startsWith("| 151-600"))).toHaveLength(1);
    expect(applied[1]?.lines.filter((l) => l.startsWith("| 0-150"))).toHaveLength(1);
    expect(applied[1]?.lines).toContain("1. The minimum clear distance may be 2 feet");
    expect(applied[1]?.lines[applied[1].lines.length - 1]).toBe("Other text");
    expect(pages[1]?.lines[0]).toBe("3 (1)");
  });
});

describe("detectTableCandidates", () => {
  it("reports runs of short lines that are not covered by a registered table", () => {
    const candidatePages: PageLines[] = [
      {
        page_index: 5,
        lines: [
          "Intro sentence that is long enough to be prose.",
          "Item",
          "Size",
          "Qty",
          "Gauze",
          "2 in",
          "4",
          "Tape",
          "1 roll",
          "1",
          "Closing sentence that is long enough.",
        ],
      },
    ];
    const found = detectTableCandidates(candidatePages, [], { fromPage: 1 });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ page: 5, from: 2, to: 10 });
    expect(
      detectTableCandidates(candidatePages, [{ page: 5, from: 2, to: 10 }], { fromPage: 1 }),
    ).toHaveLength(0);
  });
});

describe("explicit rows", () => {
  it("uses the registry rows when the text layer dropped empty cells", () => {
    const matrix: PageLines[] = [
      {
        page_index: 1,
        lines: [
          "Job Type",
          "General",
          "Specific",
          "Office",
          "X",
          "Field",
          "X",
          "Document all training.",
        ],
      },
    ];
    const { tables, problems } = reconstructTables(matrix, [
      {
        id: "m",
        page: 1,
        header: ["Job Type", "General", "Specific"],
        end_before: "Document all training",
        rows: [
          ["Office", "X", ""],
          ["Field", "", "X"],
        ],
      },
    ]);
    expect(problems).toEqual([]);
    expect(tables[0]?.rows).toEqual([
      ["Office", "X", ""],
      ["Field", "", "X"],
    ]);
    expect(tables[0]?.consumed).toEqual([{ page: 1, from: 1, to: 7 }]);
  });
});
