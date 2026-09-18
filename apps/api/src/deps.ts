import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { createDeps, type Deps, getConfig, loadPlaybooks } from "@axxiom/core";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

let cachedSql: postgres.Sql | null = null;
export function getSql(): postgres.Sql {
  if (!cachedSql)
    cachedSql = postgres(requireEnv("DATABASE_URL"), { prepare: false, max: 5, idle_timeout: 30 });
  return cachedSql;
}

let cachedDeps: Deps | null = null;
export function getDeps(): Deps {
  if (!cachedDeps) {
    const playbooksPath =
      process.env.EMERGENCY_PLAYBOOKS_PATH ??
      path.join(
        process.env.INIT_CWD ?? process.cwd(),
        "corpus/axxiom-s2/v1.0/emergency-playbooks.json",
      );
    cachedDeps = createDeps({
      sql: getSql(),
      playbooks: loadPlaybooks(playbooksPath),
      anthropic: new Anthropic({ maxRetries: 2, timeout: 120_000 }),
      config: getConfig(),
    });
  }
  return cachedDeps;
}

export function getStorage() {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  }).storage.from(process.env.SUPABASE_STORAGE_BUCKET ?? "manuals");
}
