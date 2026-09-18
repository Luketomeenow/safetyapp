import Anthropic from "@anthropic-ai/sdk";
import { createDeps, type Deps, getConfig, loadPlaybooks, type Playbooks } from "@axxiom/core";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import bundledPlaybooks from "../../../corpus/axxiom-s2/v1.0/emergency-playbooks.json" with {
  type: "json",
};
import { langfuseTracer } from "./tracing.ts";

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
    cachedDeps = createDeps({
      sql: getSql(),
      // Bundled at build time so the deployed function needs no filesystem access; overridable for tests.
      playbooks: process.env.EMERGENCY_PLAYBOOKS_PATH
        ? loadPlaybooks(process.env.EMERGENCY_PLAYBOOKS_PATH)
        : (bundledPlaybooks as Playbooks),
      anthropic: new Anthropic({ maxRetries: 2, timeout: 120_000 }),
      config: getConfig(),
      ...(process.env.LANGFUSE_PUBLIC_KEY ? { tracer: langfuseTracer } : {}),
    });
  }
  return cachedDeps;
}

export function getStorage() {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  }).storage.from(process.env.SUPABASE_STORAGE_BUCKET ?? "manuals");
}
