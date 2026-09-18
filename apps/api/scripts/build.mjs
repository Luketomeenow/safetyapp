// Produces a Vercel Build Output API (v3) directory: one bundled Node function that receives every
// path, plus routing and cron config. Deploy with `vercel deploy --prebuilt --prod` from the repo root.

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const out = process.env.VERCEL_OUTPUT ?? path.join(root, "../../.vercel/output");
const fn = path.join(out, "functions/api.func");

await rm(out, { recursive: true, force: true });
await mkdir(fn, { recursive: true });
await mkdir(path.join(out, "static"), { recursive: true });

await build({
  entryPoints: [path.join(root, "src/vercel-entry.ts")],
  outfile: path.join(fn, "index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  logLevel: "info",
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});

await writeFile(
  path.join(fn, ".vc-config.json"),
  JSON.stringify(
    {
      runtime: "nodejs22.x",
      handler: "index.mjs",
      launcherType: "Nodejs",
      shouldAddHelpers: false,
      supportsResponseStreaming: true,
      maxDuration: 300,
      regions: ["iad1"],
    },
    null,
    2,
  ),
);
await writeFile(path.join(fn, "package.json"), JSON.stringify({ type: "module" }));
await writeFile(
  path.join(out, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [{ src: "/(.*)", dest: "/api" }],
      crons: [{ path: "/internal/cache-keepalive", schedule: "45 12 * * *" }],
    },
    null,
    2,
  ),
);
process.stdout.write(`build output written to ${out}\n`);
