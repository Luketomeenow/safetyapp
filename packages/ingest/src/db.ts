import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { requireEnv } from "./env.ts";

/** Postgres through the Supabase transaction pooler: no prepared statements. */
export function connectDb() {
  return postgres(requireEnv("DATABASE_URL"), { prepare: false, max: 3, idle_timeout: 20 });
}

export function storageClient() {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}
