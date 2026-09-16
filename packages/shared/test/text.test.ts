import { describe, expect, it } from "vitest";
import { diceCoefficient, normalizeForMatch, normalizeHeading, toModelText } from "../src/index.ts";

describe("toModelText", () => {
  it("strips zero-width spaces, trailing spaces and collapses blank runs", () => {
    expect(toModelText("●​ Item  \n\n\n\nNext\n")).toBe("● Item\n\nNext");
  });
  it("keeps curly quotes and typos so quotes still match the PDF", () => {
    expect(toModelText("the wearer’s SUPERVISIOR")).toBe("the wearer’s SUPERVISIOR");
  });
});

describe("normalizeForMatch", () => {
  it("folds curly quotes and dashes to ASCII and lowercases", () => {
    expect(normalizeForMatch("“Don’t” – de‐energized")).toBe('"don\'t" - de-energized');
  });
  it("applies NFKC so superscripts and fractions compare equal", () => {
    expect(normalizeForMatch("32 in²")).toBe("32 in2");
  });
  it("collapses whitespace including line breaks", () => {
    expect(normalizeForMatch("always use locks\nover   tags")).toBe("always use locks over tags");
  });
});

describe("normalizeHeading", () => {
  it("strips list numbers, bullets and trailing punctuation", () => {
    expect(normalizeHeading("1.​ Occupational Head Protection")).toBe(
      "occupational head protection",
    );
    expect(normalizeHeading("● Training:")).toBe("training");
    expect(normalizeHeading("8.6 De-energizing Procedure")).toBe("de-energizing procedure");
  });
});

describe("diceCoefficient", () => {
  it("is 1 for identical token sets and 0 for disjoint ones", () => {
    expect(diceCoefficient("hoistway safety", "hoistway safety")).toBe(1);
    expect(diceCoefficient("hoistway safety", "used oil")).toBe(0);
  });
  it("is partial for overlapping sets", () => {
    expect(diceCoefficient("fall protection program", "fall protection")).toBeCloseTo(0.8, 5);
  });
});
