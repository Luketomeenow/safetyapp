import { existsSync } from "node:fs";
import path from "node:path";

/** Loads <repoRoot>/.env into process.env (existing variables win). Node 24 has process.loadEnvFile. */
export function loadEnv(repoRoot: string): void {
  const file = path.join(repoRoot, ".env");
  if (!existsSync(file)) return;
  const before = { ...process.env };
  process.loadEnvFile(file);
  for (const [k, v] of Object.entries(before)) if (v !== undefined) process.env[k] = v;
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name} (set it in .env)`);
  return v;
}
