import { existsSync } from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { app } from "./app.ts";

const envFile = path.join(process.env.INIT_CWD ?? process.cwd(), ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => {
  process.stdout.write(`api listening on http://localhost:${port}\n`);
});
