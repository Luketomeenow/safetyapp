import { describe, expect, it } from "vitest";
import { extractQuotes, parseMarker, validateAnswer, verifyQuote } from "../src/validate.ts";
import { fixtureManual } from "./fixtures.ts";

const manual = fixtureManual();

describe("parseMarker", () => {
  it("reads the first-line marker and strips it", () => {
    expect(parseMarker("[[AXX:ANSWER]]\n**Answer**\nUse a lock.")).toEqual({
      kind: "answer",
      body: "**Answer**\nUse a lock.",
    });
    expect(parseMarker("[[AXX:NOT_COVERED]]\nThe manual does not cover PTO.").kind).toBe(
      "not_covered",
    );
    expect(parseMarker("Sure! Here is the answer").kind).toBeNull();
  });
});

describe("extractQuotes", () => {
  it("collects blockquotes with their Source lines", () => {
    const body = [
      "**Answer**",
      "Use a lock.",
      "**Policy text**",
      "> If the energy source has a lockout point, always use locks over tags.",
      "Source: Program 8 (Lockout/Tagout/Tryout Program), 8.4 Locking and Tagging Circuits, page 2.",
      "> All Lockout/Tagout devices must be: [...] Capable of withstanding the environment",
      "",
      "Source: Program 8 (Lockout/Tagout/Tryout Program), 8.5 Lockout/Tagout Devices, page 3",
      "**Conditions and stop points**",
      "None stated in the document.",
    ].join("\n");
    const quotes = extractQuotes(body);
    expect(quotes).toHaveLength(2);
    expect(quotes[0]).toMatchObject({ sourcePage: 2, sourceProgram: 8, sourceSection: "8.4" });
    expect(quotes[1]?.fragments).toEqual([
      "All Lockout/Tagout devices must be:",
      "Capable of withstanding the environment",
    ]);
    expect(quotes[1]?.sourcePage).toBe(3);
  });
});

describe("verifyQuote", () => {
  it("finds a quote that spans a line break and resolves its section", () => {
    const [q] = extractQuotes(
      "> Only when an energy source does not have a lockout point, should a tag be used\nSource: Program 8, 8.4, page 2",
    );
    const check = verifyQuote(manual, q!, [2]);
    expect(check.found).toBe(true);
    expect(check.page).toBe(2);
    expect(check.sectionNumber).toBe("8.4");
  });
  it("accepts [...] gaps in order and rejects out-of-order fragments", () => {
    const [ok] = extractQuotes(
      "> All Lockout/Tagout devices must be: [...] period that exposure is expected.",
    );
    expect(verifyQuote(manual, ok!, [3]).found).toBe(true);
    const [bad] = extractQuotes(
      "> period that exposure is expected. [...] All Lockout/Tagout devices must be:",
    );
    expect(verifyQuote(manual, bad!, [3]).found).toBe(false);
  });
  it("tolerates curly quotes and searches neighbor pages", () => {
    const [q] = extractQuotes("> the Company does not believe that tags are as secure as locks");
    expect(verifyQuote(manual, q!, [3]).found).toBe(true); // page 2 is a neighbor of 3
  });
});

describe("validateAnswer", () => {
  const body =
    "**Answer**\nUse a lock.\n**Policy text**\n> always use locks over tags\nSource: Program 8, 8.4, page 2\n**Conditions and stop points**\nNone stated in the document.";
  const citedTexts = new Map([[2, manual.pages[1]!.block_text]]);
  it("passes a cited, verifiable answer", () => {
    const v = validateAnswer(manual, {
      kind: "answer",
      body,
      citedPages: [2],
      citedTexts,
      stopReason: "end_turn",
    });
    expect(v.passed).toBe(true);
    expect(v.quotesVerified).toBe(true);
    expect(v.validPages).toEqual([2]);
  });
  it("rejects a citation to a TOC page but keeps a page grounded by a verified quote", () => {
    const v = validateAnswer(manual, {
      kind: "answer",
      body,
      citedPages: [1],
      citedTexts: new Map(),
      stopReason: "end_turn",
    });
    expect(v.passed).toBe(false);
    expect(v.problems).toContain("citation to non-citable page 1");
    expect(v.validPages).toEqual([2]); // from the verified quote's Source page
  });
  it("rejects an answer with neither a verifiable quote nor a citation", () => {
    const noQuote =
      "**Answer**\nUse a lock.\n**Policy text**\n> this sentence is not in the manual at all, really\nSource: Program 8, 8.4, page 2";
    const v = validateAnswer(manual, {
      kind: "answer",
      body: noQuote,
      citedPages: [],
      citedTexts: new Map(),
      stopReason: "end_turn",
    });
    expect(v.passed).toBe(false);
    expect(v.problems.some((p) => p.startsWith("quote not found"))).toBe(true);
    expect(v.problems).toContain("answer has no verified quote or citation");
  });
  it("fails a missing marker and a stale cited_text", () => {
    expect(
      validateAnswer(manual, { kind: null, body, citedPages: [2], citedTexts, stopReason: null })
        .problems[0],
    ).toMatch(/marker/);
    const stale = validateAnswer(manual, {
      kind: "answer",
      body,
      citedPages: [2],
      citedTexts: new Map([[2, "different"]]),
      stopReason: null,
    });
    expect(stale.problems.some((p) => p.includes("stale"))).toBe(true);
  });
  it("lets not_covered answers through without citations", () => {
    expect(
      validateAnswer(manual, {
        kind: "not_covered",
        body: "The manual does not cover this.",
        citedPages: [],
        citedTexts: new Map(),
        stopReason: "end_turn",
      }).passed,
    ).toBe(true);
  });
});

describe("hardening", () => {
  it("accepts a marker followed by text on the same line", () => {
    expect(parseMarker("[[AXX:NOT_COVERED]] The manual does not cover this.")).toEqual({
      kind: "not_covered",
      body: "The manual does not cover this.",
    });
  });
  it("finds a quote that continues onto the next page and one with no Source page or citations", () => {
    const manual = fixtureManual();
    const [crossing] = extractQuotes(
      "> are as secure as locks. Lockout/Tagout Devices All Lockout/Tagout devices must be:",
    );
    expect(verifyQuote(manual, crossing!, []).page).toBe(2);
    const [orphan] = extractQuotes(
      "> Capable of withstanding the environment to which they are exposed",
    );
    expect(verifyQuote(manual, orphan!, []).page).toBe(3);
  });
  it("parses Source lines with page ranges", () => {
    const [q] = extractQuotes(
      "> always use locks over tags\nSource: Program 8 (Lockout/Tagout/Tryout Program), 8.4 Locking and Tagging Circuits, pages 56-57.",
    );
    expect(q?.sourcePage).toBe(56);
  });
});

describe("multi-line blockquotes", () => {
  it("verifies each quoted line separately on the same page, ignoring leading bullets", () => {
    const manual = fixtureManual();
    const [q] = extractQuotes(
      "> ● Capable of withstanding the environment to which they are exposed for the maximum\n> All Lockout/Tagout devices must be:\nSource: Program 8, 8.5, page 3",
    );
    expect(q?.lines).toHaveLength(2);
    const check = verifyQuote(manual, q!, [3]);
    expect(check.found).toBe(true);
    expect(check.sectionNumber).toBe("8.5");
  });
});

describe("markdown inside quotes", () => {
  it("ignores bold markers the model adds inside a quoted line", () => {
    const manual = fixtureManual();
    const [q] = extractQuotes(
      "> **Capable of withstanding** the environment to which they are exposed",
    );
    expect(verifyQuote(manual, q!, []).found).toBe(true);
  });
});
