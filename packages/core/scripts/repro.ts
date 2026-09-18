import path from "node:path";
import { answerQuestion, createDeps, loadPlaybooks } from "@axxiom/core";
import postgres from "postgres";

const root = process.env.INIT_CWD ?? process.cwd();
process.loadEnvFile(path.join(root, ".env"));
const sql = postgres(process.env.DATABASE_URL as string, { prepare: false, max: 2 });
const deps = createDeps({
  sql,
  playbooks: loadPlaybooks(path.join(root, "corpus/axxiom-s2/v1.0/emergency-playbooks.json")),
});
const [user] = await sql<{ id: string }[]>`select id from app_users where issuer='smoke' limit 1`;
const gen = answerQuestion(
  { userId: user!.id, message: process.argv[2] as string, persist: false },
  deps,
);
let raw = "";
for (;;) {
  const n = await gen.next();
  if (n.done) {
    console.log(
      "\n--- kind",
      n.value.kind,
      "\nproblems:",
      n.value.validation.problems,
      "\ncitations:",
      n.value.citations.map((c) => [c.page, c.section?.number]),
    );
    break;
  }
  if (n.value.event === "text") raw += n.value.data.delta;
}
console.log("\n--- model text ---\n" + raw);
await sql.end();
