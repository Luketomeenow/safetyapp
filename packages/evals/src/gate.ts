import type { CaseResult, SetName, Thresholds } from "./schema.ts";

export type GateReport = {
  profile: string;
  passed: boolean;
  failures: string[];
  warnings: string[];
  by_set: Record<string, { total: number; passed: number; rate: number | null }>;
  non_negotiable: { total: number; passed: number; rate: number | null };
  uncited_answers: number;
  error_rate: number;
  ttft_p95_ms: number | null;
  total_p95_ms: number | null;
  cost_usd: number;
  judge_cost_usd: number;
  needs_human_review: number;
};

function p95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? null;
}

/** Recomputes pass rates and invariants from results; draft cases are reported but never gate. */
export function gate(
  profile: string,
  thresholds: Thresholds,
  results: CaseResult[],
  needsReauthoring: string[],
): GateReport {
  const t = thresholds.profiles[profile];
  if (!t) throw new Error(`unknown profile ${profile}`);
  const gating = results.filter((r) => r.status === "safety-manager-approved");
  const scoreSet = (rs: CaseResult[]) => ({
    total: rs.length,
    passed: rs.filter((r) => r.pass).length,
    rate: rs.length ? rs.filter((r) => r.pass).length / rs.length : null,
  });
  const by_set: GateReport["by_set"] = {};
  for (const set of ["golden", "negative", "adversarial", "emergency"] as SetName[])
    by_set[set] = scoreSet(results.filter((r) => r.set === set));
  const nn = scoreSet(results.filter((r) => r.non_negotiable));
  const failures: string[] = [];
  const warnings: string[] = [];
  const gatingBySet = (set: SetName) => scoreSet(gating.filter((r) => r.set === set));
  for (const set of ["golden", "negative", "adversarial", "emergency"] as SetName[]) {
    const s = gatingBySet(set);
    const min = t.min_pass_rate[set];
    if (s.total > 0 && s.rate !== null && s.rate < min)
      failures.push(
        `${set}: ${(s.rate * 100).toFixed(1)}% approved cases passed, below ${(min * 100).toFixed(0)}%`,
      );
    const all = by_set[set];
    if (all && all.total > 0 && all.rate !== null && all.rate < min && s.total === 0)
      warnings.push(`${set} (drafts only, non-gating): ${(all.rate * 100).toFixed(1)}% passed`);
  }
  const nnGating = scoreSet(gating.filter((r) => r.non_negotiable));
  if (
    nnGating.total > 0 &&
    nnGating.rate !== null &&
    nnGating.rate < t.min_pass_rate.non_negotiable
  )
    failures.push(`non-negotiable controls: ${nnGating.passed}/${nnGating.total} passed`);
  const uncited = results.filter(
    (r) => r.deterministic.kind === "answer" && !r.deterministic.has_citation,
  ).length;
  if (uncited > t.max_uncited_answers)
    failures.push(`${uncited} answers returned without any citation`);
  const invalid = results.filter(
    (r) => r.deterministic.kind === "answer" && !r.deterministic.citations_valid,
  ).length;
  if (invalid > 0)
    failures.push(`${invalid} answers with invalid citations or unverifiable quotes`);
  const errors = results.filter((r) => r.error !== null).length;
  const error_rate = results.length ? errors / results.length : 0;
  if (error_rate > t.max_error_rate)
    failures.push(
      `error rate ${(error_rate * 100).toFixed(1)}% exceeds ${(t.max_error_rate * 100).toFixed(0)}%`,
    );
  const wrongModel = results.filter(
    (r) => r.model && !r.model.startsWith("claude-opus-5") && r.deterministic.kind !== "emergency",
  ).length;
  if (wrongModel > 0)
    warnings.push(`${wrongModel} answers served by a model other than claude-opus-5 (fallback?)`);
  const ttft = p95(
    results.map((r) => r.deterministic.ttft_ms).filter((v): v is number => v !== null),
  );
  const total = p95(
    results
      .filter((r) => r.deterministic.kind !== "emergency" && r.error === null)
      .map((r) => r.deterministic.total_ms),
  );
  if (ttft !== null && ttft > t.latency.ttft_p95_ms)
    (t.latency.gate ? failures : warnings).push(
      `p95 time to first token ${ttft} ms exceeds ${t.latency.ttft_p95_ms} ms`,
    );
  if (total !== null && total > t.latency.total_p95_ms)
    (t.latency.gate ? failures : warnings).push(
      `p95 total latency ${total} ms exceeds ${t.latency.total_p95_ms} ms`,
    );
  if (needsReauthoring.length > 0 && profile === "release")
    failures.push(
      `${needsReauthoring.length} not-covered cases need re-authoring: ${needsReauthoring.join(", ")}`,
    );
  return {
    profile,
    passed: failures.length === 0,
    failures,
    warnings,
    by_set,
    non_negotiable: nn,
    uncited_answers: uncited,
    error_rate,
    ttft_p95_ms: ttft,
    total_p95_ms: total,
    cost_usd: results.reduce((s, r) => s + r.cost_usd, 0),
    judge_cost_usd: results.reduce((s, r) => s + r.judge_cost_usd, 0),
    needs_human_review: results.filter((r) => r.needs_human_review).length,
  };
}
