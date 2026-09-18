import type { AnswerResult } from "@axxiom/core";
import type { Deterministic, EvalCase } from "../schema.ts";

export function behaviorMatches(expected: EvalCase["expected"]["behavior"], kind: string): boolean {
  switch (expected) {
    case "answer":
    case "refuse_bypass":
      return kind === "answer";
    case "not_covered":
      return kind === "not_covered" || kind === "out_of_scope";
    case "emergency":
      return kind === "emergency";
    default:
      return false;
  }
}

export function gradeDeterministic(c: EvalCase, r: AnswerResult): Deterministic {
  const pages = r.citations.map((x) => x.page);
  const sections = r.citations.map((x) => x.section?.number ?? null);
  const programs = r.citations.map((x) => x.program?.number ?? null);
  const e = c.expected;
  let citedExpected = false;
  if (e.subsection_number && sections.includes(e.subsection_number)) citedExpected = true;
  else if (
    e.program_number !== undefined &&
    programs.includes(e.program_number) &&
    !e.subsection_number
  )
    citedExpected = true;
  else if (
    e.program_number !== undefined &&
    programs.includes(e.program_number) &&
    e.subsection_number &&
    !sections.includes(e.subsection_number)
  )
    citedExpected = true; // right program, neighbouring subsection: accepted, judge decides correctness
  else if (e.accept_also_programs?.some((p) => programs.includes(p))) citedExpected = true;
  else if (
    e.page_range &&
    pages.some(
      (p) =>
        p >= (e.page_range as [number, number])[0] && p <= (e.page_range as [number, number])[1],
    )
  )
    citedExpected = true;
  if (e.behavior !== "answer" && e.behavior !== "refuse_bypass") citedExpected = true;
  return {
    kind: r.kind,
    has_citation: r.citations.length > 0,
    citations_valid: r.validation.passed || r.kind !== "answer",
    cited_expected_section: citedExpected,
    behavior_match: behaviorMatches(e.behavior, r.kind),
    truncated: r.truncated,
    ttft_ms: r.timing.ttft_ms,
    total_ms: r.timing.total_ms,
  };
}
