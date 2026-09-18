/**
 * Keyed smoke test against the real API and the staging database.
 * Usage: pnpm --filter @axxiom/core smoke [question ...]
 */
import path from "node:path";
import postgres from "postgres";
import { answerQuestion, createDeps, loadPlaybooks } from "../src/index.ts";

const repoRoot = process.env.INIT_CWD ?? process.cwd();
process.loadEnvFile(path.join(repoRoot, ".env"));
const sql = postgres(process.env.DATABASE_URL as string, { prepare: false, max: 2 });
const deps = createDeps({
  sql,
  playbooks: loadPlaybooks(path.join(repoRoot, "corpus/axxiom-s2/v1.0/emergency-playbooks.json")),
});

const questions =
  process.argv.slice(2).filter((a) => a !== "--").length > 0
    ? process.argv.slice(2).filter((a) => a !== "--")
    : [
        "When can I use a tag instead of a lock?",
        "How much PTO do I accrue per year?",
        "my helper is unconscious in the pit",
      ];

const [user] = await sql<{ id: string }[]>`
  insert into app_users (issuer, subject) values ('smoke', 'smoke-user') on conflict (issuer, subject) do update set subject = excluded.subject returning id`;

for (const question of questions) {
  process.stdout.write(`\n=== ${question}\n`);
  const gen = answerQuestion(
    {
      userId: user!.id,
      message: question,
      clientMessageId: `smoke-${Date.now()}-${Math.random()}`,
    },
    deps,
  );
  let text = "";
  for (;;) {
    const next = await gen.next();
    if (next.done) {
      const r = next.value;
      process.stdout.write(
        `\n--- kind=${r.kind} model=${r.model} stop=${r.stopReason} ttft=${r.timing.ttft_ms}ms total=${r.timing.total_ms}ms\n`,
      );
      process.stdout.write(
        `usage=${JSON.stringify(r.usage)} validation=${JSON.stringify(r.validation)}\n`,
      );
      process.stdout.write(
        `citations=${JSON.stringify(r.citations.map((c) => ({ page: c.page, section: c.section?.number, quote: c.quote?.slice(0, 60) })))}\n`,
      );
      break;
    }
    const ev = next.value;
    if (ev.event === "text") text += ev.data.delta;
    else if (ev.event === "status") process.stdout.write(`[${ev.data.stage}] `);
    else if (ev.event === "citation") process.stdout.write(`[cite p${ev.data.page}] `);
    else if (ev.event === "emergency") process.stdout.write(`[EMERGENCY ${ev.data.headline}] `);
    else if (ev.event === "replace") process.stdout.write(`[REPLACE ${ev.data.reason}] `);
    else if (ev.event === "error")
      process.stdout.write(`[ERROR ${ev.data.code}: ${ev.data.message}] `);
  }
  process.stdout.write(`\n${text.slice(0, 1500)}\n`);
}
await sql.end();
