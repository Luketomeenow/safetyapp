import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { loadActiveManual, PROMPT_FINGERPRINT } from "@axxiom/core";
import postgres from "postgres";
import { appendInbox, draftProgram, INBOX_GOLDEN, readInbox } from "./drafting.ts";
import { gate } from "./gate.ts";
import { DATA_DIR, loadCases, loadThresholds, sampleCases } from "./load.ts";
import { renderMarkdown } from "./report.ts";
import { runEval } from "./runner.ts";
import type { CaseResult, EvalCase, SetName } from "./schema.ts";
import { applySheet, exportSheet } from "./sheet.ts";

const USAGE = `Usage:
  eval validate-data
  eval run --profile smoke|pr|release [--seed N] [--concurrency 2] [--no-judge] [--set golden --sample N] [--ids A,B]
  eval gate --run <runDir> --profile <profile>
  eval draft --programs 8,9,12 | --all [--dry-run]
  eval sheet export [--file data/review/golden-seed-review.csv]
  eval sheet import --file <csv> --by "<name>"
`;

const args = process.argv.slice(2).filter((a, i, all) => !(a === "--" && all.indexOf("--") === i));
const { values, positionals } = parseArgs({
  args,
  allowPositionals: true,
  options: {
    profile: { type: "string" },
    seed: { type: "string", default: "7" },
    concurrency: { type: "string", default: "2" },
    ids: { type: "string" },
    "no-judge": { type: "boolean", default: false },
    set: { type: "string" },
    sample: { type: "string" },
    run: { type: "string" },
    programs: { type: "string" },
    all: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    file: { type: "string" },
    by: { type: "string" },
  },
});

// A run costs real money: never let one stray socket error kill the process before the report.
process.on("unhandledRejection", (reason) => {
  process.stderr.write(`warning: unhandled rejection ignored: ${String(reason).slice(0, 200)}\n`);
});
process.on("uncaughtException", (error) => {
  process.stderr.write(`warning: uncaught exception ignored: ${String(error).slice(0, 200)}\n`);
});

const repoRoot = process.env.INIT_CWD ?? process.cwd();
const envFile = path.join(repoRoot, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
const RUNS_DIR = path.join(import.meta.dirname, "..", "runs");
const resolveFile = (f: string) => (path.isAbsolute(f) ? f : path.join(repoRoot, f));

function gitSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "uncommitted";
  }
}

function includedDocs(): string[] {
  const manifest = path.join(repoRoot, "corpus/axxiom-s2/v1.0/manifest.json");
  return existsSync(manifest)
    ? ((JSON.parse(readFileSync(manifest, "utf8")) as { included_docs: string[] })
        .included_docs ?? ["section-2"])
    : ["section-2"];
}

function fail(msg: string, code = 2): never {
  process.stderr.write(`${msg}\n`);
  process.exit(code);
}

async function main(): Promise<void> {
  const command = positionals[0];
  if (command === "validate-data") {
    const loaded = loadCases(includedDocs(), { includeDrafts: true });
    for (const p of loaded.problems) process.stderr.write(`invalid: ${p}\n`);
    const bySet = new Map<string, number>();
    for (const c of loaded.cases)
      bySet.set(`${c.set}/${c.source.status}`, (bySet.get(`${c.set}/${c.source.status}`) ?? 0) + 1);
    for (const [k, n] of [...bySet.entries()].sort()) process.stdout.write(`${k}: ${n}\n`);
    if (loaded.needs_reauthoring.length)
      process.stdout.write(`needs re-authoring: ${loaded.needs_reauthoring.join(", ")}\n`);
    process.exit(loaded.problems.length > 0 ? 3 : 0);
  }
  if (command === "run") {
    const profile = values.profile ?? fail(USAGE);
    const thresholds = loadThresholds();
    const t = thresholds.profiles[profile] ?? fail(`unknown profile ${profile}`);
    const loaded = loadCases(includedDocs(), { includeDrafts: t.include_drafts });
    if (loaded.problems.length) fail(`invalid data:\n${loaded.problems.join("\n")}`, 3);
    let cases: EvalCase[];
    if (values.ids) {
      const wanted = new Set(values.ids.split(",").map((x) => x.trim()));
      cases = loaded.cases.filter((c) => wanted.has(c.id));
    } else if (values.set) {
      const pool = loaded.cases.filter((c) => c.set === (values.set as SetName));
      cases = values.sample
        ? sampleCases(
            pool,
            {
              golden: null,
              negative: null,
              adversarial: null,
              emergency: null,
              [values.set as SetName]: Number(values.sample),
            } as Record<SetName, number | null>,
            Number(values.seed),
          )
        : pool;
    } else {
      cases = sampleCases(loaded.cases, t.sample, Number(values.seed));
    }
    const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${profile}`;
    const runDir = path.join(RUNS_DIR, runId);
    process.stdout.write(
      `running ${cases.length} cases (profile ${profile}, judge ${values["no-judge"] ? "off" : "on"}) -> ${runDir}\n`,
    );
    const out = await runEval({
      profile,
      cases,
      repsNonNegotiable: t.reps_non_negotiable,
      concurrency: Number(values.concurrency),
      runDir,
      repoRoot,
      judge: !values["no-judge"],
      onProgress: (done, total, r) =>
        process.stdout.write(
          `[${done}/${total}] ${r.pass ? "PASS" : "FAIL"} ${r.case_id} (${r.deterministic.kind}${r.fail_reasons.length ? `: ${r.fail_reasons.join("; ")}` : ""})\n`,
        ),
    });
    const g = gate(profile, thresholds, out.results, loaded.needs_reauthoring);
    const meta = {
      started_at: out.started_at,
      finished_at: out.finished_at,
      manual_version: out.manual.version_id,
      prompt_version: PROMPT_FINGERPRINT,
      git_sha: gitSha(),
    };
    writeFileSync(path.join(runDir, "report.json"), JSON.stringify({ gate: g, meta }, null, 2));
    writeFileSync(path.join(runDir, "report.md"), renderMarkdown(g, out.results, meta));
    mkdirSync(RUNS_DIR, { recursive: true });
    writeFileSync(path.join(RUNS_DIR, "latest.txt"), runDir);
    process.stdout.write(
      `\n${renderMarkdown(g, out.results, meta).split("\n").slice(0, 40).join("\n")}\n\nfull report: ${path.join(runDir, "report.md")}\n`,
    );
    process.exit(g.passed ? 0 : 1);
  }
  if (command === "gate") {
    const runDir = resolveFile(values.run ?? fail(USAGE));
    const profile = values.profile ?? fail(USAGE);
    const results = readFileSync(path.join(runDir, "results.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as CaseResult);
    const g = gate(
      profile,
      loadThresholds(),
      results,
      loadCases(includedDocs(), { includeDrafts: false }).needs_reauthoring,
    );
    process.stdout.write(`${JSON.stringify(g, null, 2)}\n`);
    process.exit(g.passed ? 0 : 1);
  }
  if (command === "draft") {
    const programs = values.all
      ? Array.from({ length: 25 }, (_, i) => i + 1)
      : (values.programs ?? fail(USAGE))
          .split(",")
          .map((s) => Number(s.trim()))
          .filter(Boolean);
    const sql = postgres(process.env.DATABASE_URL as string, { prepare: false, max: 2 });
    try {
      const manual = await loadActiveManual(sql);
      const client = new Anthropic({ maxRetries: 3, timeout: 180_000 });
      const existing = [
        ...loadCases(includedDocs(), { includeDrafts: true }).cases,
        ...readInbox(INBOX_GOLDEN),
      ];
      let total = 0;
      let cost = 0;
      for (const program of programs) {
        const { cases, summary } = await draftProgram(client, manual, program, existing);
        cost += summary.cost_usd;
        total += cases.length;
        process.stdout.write(
          `program ${program}: requested ${summary.requested}, produced ${summary.produced}, kept ${summary.kept}${summary.dropped.length ? `, dropped ${summary.dropped.length} (${summary.dropped.slice(0, 2).join(" | ")})` : ""} ($${summary.cost_usd.toFixed(3)})\n`,
        );
        if (!values["dry-run"]) appendInbox(INBOX_GOLDEN, cases);
        existing.push(...cases);
      }
      process.stdout.write(
        `${total} drafts ${values["dry-run"] ? "generated (dry run, not saved)" : `appended to ${INBOX_GOLDEN}`}; drafting cost $${cost.toFixed(2)}\n`,
      );
    } finally {
      await sql.end();
    }
    return;
  }
  if (command === "sheet") {
    const sub = positionals[1];
    const inbox = readInbox(INBOX_GOLDEN);
    const handSets = ["negative", "adversarial", "emergency"].flatMap((s) =>
      readInbox(path.join(DATA_DIR, `${s}.jsonl`)),
    );
    if (sub === "export") {
      const file = values.file
        ? resolveFile(values.file)
        : path.join(DATA_DIR, "review", "review.csv");
      mkdirSync(path.dirname(file), { recursive: true });
      const n = exportSheet(
        [...inbox, ...handSets].filter((c) => c.source.status === "draft"),
        file,
      );
      process.stdout.write(`${n} draft cases exported to ${file}\n`);
      return;
    }
    if (sub === "import") {
      const file = resolveFile(values.file ?? fail(USAGE));
      const by = values.by ?? fail("Missing --by");
      const all = [...inbox, ...handSets];
      const summary = applySheet(all, file, by);
      writeFileSync(
        INBOX_GOLDEN,
        inbox.map((c) => JSON.stringify(c)).join("\n") + (inbox.length ? "\n" : ""),
      );
      for (const s of ["negative", "adversarial", "emergency"]) {
        const rows = handSets.filter((c) => c.set === s);
        writeFileSync(
          path.join(DATA_DIR, `${s}.jsonl`),
          rows.map((c) => JSON.stringify(c)).join("\n") + (rows.length ? "\n" : ""),
        );
      }
      process.stdout.write(`${JSON.stringify(summary)}\n`);
      return;
    }
  }
  fail(USAGE);
}

main().catch((error: unknown) =>
  fail(error instanceof Error ? (error.stack ?? error.message) : String(error), 1),
);
