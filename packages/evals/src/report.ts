import type { GateReport } from "./gate.ts";
import type { CaseResult } from "./schema.ts";

export function renderMarkdown(
  g: GateReport,
  results: CaseResult[],
  meta: {
    started_at: string;
    finished_at: string;
    manual_version: string;
    prompt_version: string;
    git_sha: string;
  },
): string {
  const pct = (r: number | null) => (r === null ? "n/a" : `${(r * 100).toFixed(1)}%`);
  const out: string[] = [];
  out.push(`# Eval report: ${g.profile} (${g.passed ? "PASS" : "FAIL"})`, "");
  out.push(
    `Run ${meta.started_at} to ${meta.finished_at}. Manual ${meta.manual_version}. Prompt ${meta.prompt_version}. Git ${meta.git_sha}.`,
    "",
  );
  out.push(
    `Answer cost $${g.cost_usd.toFixed(2)}, judge cost $${g.judge_cost_usd.toFixed(2)}. p95 first token ${g.ttft_p95_ms ?? "n/a"} ms, p95 total ${g.total_p95_ms ?? "n/a"} ms. ${g.needs_human_review} results need human review.`,
    "",
  );
  if (g.failures.length) {
    out.push("## Gate failures", "");
    for (const f of g.failures) out.push(`- ${f}`);
    out.push("");
  }
  if (g.warnings.length) {
    out.push("## Warnings", "");
    for (const w of g.warnings) out.push(`- ${w}`);
    out.push("");
  }
  out.push(
    "## Pass rates (all cases, drafts included)",
    "",
    "| Set | Passed | Total | Rate |",
    "|---|---|---|---|",
  );
  for (const [set, s] of Object.entries(g.by_set))
    out.push(`| ${set} | ${s.passed} | ${s.total} | ${pct(s.rate)} |`);
  out.push(
    `| non-negotiable | ${g.non_negotiable.passed} | ${g.non_negotiable.total} | ${pct(g.non_negotiable.rate)} |`,
    "",
  );
  const failed = results.filter((r) => !r.pass);
  out.push(`## Failures (${failed.length})`, "");
  if (failed.length === 0) out.push("None.");
  for (const r of failed) {
    out.push(
      `### ${r.case_id} (${r.set}${r.non_negotiable ? ", non-negotiable" : ""}, ${r.status}) rep ${r.rep}`,
    );
    out.push(`- Reasons: ${r.fail_reasons.join("; ")}${r.error ? ` | error: ${r.error}` : ""}`);
    if (r.validation_problems.length)
      out.push(`- Validation: ${r.validation_problems.join(" | ")}`);
    out.push(
      `- Kind ${r.deterministic.kind}; citations: ${r.citations.map((c) => `p${c.page}${c.section ? ` ${c.section}` : ""}`).join(", ") || "none"}`,
    );
    if (r.judge)
      out.push(
        `- Judge: ${r.judge.correctness}, ${r.judge.groundedness}, ${r.judge.conservatism}, bypass ${r.judge.bypass_assistance}. ${r.judge.reasoning}`,
      );
    out.push(`- Answer: ${(r.raw_text || r.answer_text).replace(/\s+/g, " ").slice(0, 700)}`, "");
  }
  return out.join("\n");
}
