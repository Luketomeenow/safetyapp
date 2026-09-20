import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import {
  type AnswerResult,
  answerOnce,
  createDeps,
  type Deps,
  type LoadedManual,
  loadActiveManual,
  loadPlaybooks,
} from "@axxiom/core";
import postgres from "postgres";
import { costUsd } from "./cost.ts";
import { gradeDeterministic } from "./graders/deterministic.ts";
import { JUDGE_PROMPT_VERSION, judgeAnswer, passRules } from "./graders/judge.ts";
import type { CaseResult, EvalCase, Usage } from "./schema.ts";

export type RunOptions = {
  profile: string;
  cases: EvalCase[];
  repsNonNegotiable: number;
  concurrency: number;
  runDir: string;
  repoRoot: string;
  judge: boolean;
  onProgress?: (done: number, total: number, r: CaseResult) => void;
};

export type RunOutput = {
  results: CaseResult[];
  manual: LoadedManual;
  started_at: string;
  finished_at: string;
};

const EMPTY: Usage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};

/** A hung stream must not block a worker; the SDK's own timeout does not cover a stalled read. */
const PER_CASE_TIMEOUT_MS = Number(process.env.EVAL_CASE_TIMEOUT_MS ?? 180_000);

function isTransient(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /ECONNRESET|ETIMEDOUT|EPIPE|socket hang up|fetch failed|network|AbortError|terminated/i.test(
    text,
  );
}

async function answerWithLimits(c: EvalCase, deps: Deps, userId: string): Promise<AnswerResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PER_CASE_TIMEOUT_MS);
    try {
      return await answerOnce(
        { userId, message: c.question, persist: false, signal: controller.signal },
        deps,
      );
    } catch (error) {
      lastError = error;
      if (attempt === 2 || !isTransient(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function runOne(
  c: EvalCase,
  rep: number,
  deps: Deps,
  judgeClient: Anthropic | null,
  manual: LoadedManual,
  userId: string,
): Promise<CaseResult> {
  const base = {
    case_id: c.id,
    set: c.set,
    rep,
    status: c.source.status,
    non_negotiable: c.tags.non_negotiable,
    prompt_version: "",
    manual_version: manual.version_id,
    judge: null as CaseResult["judge"],
    judge_usage: null as Usage | null,
    judge_cost_usd: 0,
  };
  let r: AnswerResult;
  try {
    r = await answerWithLimits(c, deps, userId);
  } catch (error) {
    return {
      ...base,
      pass: false,
      fail_reasons: ["harness error"],
      needs_human_review: false,
      deterministic: {
        kind: "error",
        has_citation: false,
        citations_valid: false,
        cited_expected_section: false,
        behavior_match: false,
        truncated: false,
        ttft_ms: null,
        total_ms: 0,
      },
      answer_text: "",
      raw_text: "",
      validation_problems: [],
      citations: [],
      model: null,
      usage: EMPTY,
      cost_usd: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const det = gradeDeterministic(c, r);
  let judge: CaseResult["judge"] = null;
  let judgeUsage: Usage | null = null;
  let judgeModel: string | null = null;
  let judgeError: string | null = null;
  if (judgeClient && r.kind !== "error" && r.kind !== "emergency") {
    const j = await judgeAnswer(judgeClient, manual, c, r);
    judge = j.verdict;
    judgeUsage = j.usage;
    judgeModel = j.model;
    judgeError = j.error;
  }
  const reasons = r.kind === "error" ? ["answer pipeline error"] : passRules(c, det, judge);
  if (judgeError && r.kind !== "emergency") reasons.push(`judge error: ${judgeError}`);
  return {
    ...base,
    prompt_version: r.promptVersion,
    pass: reasons.length === 0,
    fail_reasons: reasons,
    needs_human_review: reasons.length > 0 || judge?.correctness === "partially_correct",
    deterministic: det,
    judge,
    answer_text: r.displayText,
    raw_text: r.rawText,
    validation_problems: r.validation.problems,
    citations: r.citations.map((x) => ({
      page: x.page,
      section: x.section?.number ?? null,
      quote: x.quote,
    })),
    model: r.model,
    usage: r.usage,
    judge_usage: judgeUsage,
    cost_usd: costUsd(r.model, r.usage),
    judge_cost_usd: costUsd(judgeModel, judgeUsage),
    error: null,
  };
}

export async function runEval(o: RunOptions): Promise<RunOutput> {
  const started_at = new Date().toISOString();
  const sql = postgres(process.env.DATABASE_URL as string, {
    prepare: false,
    max: 4,
    idle_timeout: 20,
    max_lifetime: 300,
    connect_timeout: 15,
    onnotice: () => {},
  });
  const deps = createDeps({
    sql,
    playbooks: loadPlaybooks(
      path.join(o.repoRoot, "corpus/axxiom-s2/v1.0/emergency-playbooks.json"),
    ),
  });
  const judgeClient = o.judge ? new Anthropic({ maxRetries: 3, timeout: 120_000 }) : null;
  mkdirSync(o.runDir, { recursive: true });
  const resultsFile = path.join(o.runDir, "results.jsonl");
  writeFileSync(resultsFile, "");
  try {
    const manual = await loadActiveManual(sql);
    const [user] = await sql<{ id: string }[]>`
      insert into app_users (issuer, subject) values ('eval', ${`eval-${o.profile}`}) on conflict (issuer, subject) do update set subject = excluded.subject returning id`;
    const userId = user?.id ?? "";
    const jobs: { c: EvalCase; rep: number }[] = [];
    for (const c of o.cases) {
      const reps = c.tags.non_negotiable ? o.repsNonNegotiable : 1;
      for (let rep = 1; rep <= reps; rep += 1) jobs.push({ c, rep });
    }
    const results: CaseResult[] = [];
    // Warm the cache with the first job alone so later jobs read the cached prefix.
    const first = jobs.shift();
    if (first) {
      const r = await runOne(first.c, first.rep, deps, judgeClient, manual, userId);
      results.push(r);
      appendFileSync(resultsFile, `${JSON.stringify(r)}\n`);
      o.onProgress?.(results.length, jobs.length + 1, r);
    }
    let next = 0;
    const total = jobs.length + 1;
    const worker = async () => {
      for (;;) {
        const i = next;
        next += 1;
        const job = jobs[i];
        if (!job) return;
        const r = await runOne(job.c, job.rep, deps, judgeClient, manual, userId);
        results.push(r);
        appendFileSync(resultsFile, `${JSON.stringify(r)}\n`);
        o.onProgress?.(results.length, total, r);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, o.concurrency) }, () => worker()));
    return { results, manual, started_at, finished_at: new Date().toISOString() };
  } finally {
    await sql.end();
  }
}

export { JUDGE_PROMPT_VERSION };
