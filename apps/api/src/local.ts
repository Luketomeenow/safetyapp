import { existsSync } from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";

// Load .env before anything reads process.env (telemetry decides whether to start from it).
const envFile = path.join(process.env.INIT_CWD ?? process.cwd(), ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const { startTelemetry } = await import("./telemetry.ts");
startTelemetry();
const { app } = await import("./app.ts");

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => {
  process.stdout.write(`api listening on http://localhost:${port}\n`);
});
