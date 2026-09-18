import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { activateVersion, writeApproval } from "./activate.ts";
import type { BlockPage } from "./blocks.ts";
import { loadEnv } from "./env.ts";
import { publishVersion } from "./publish.ts";
import { runIngest } from "./run.ts";

const USAGE = `Usage:
  ingest run --pdf <file> --version-id <id> [--slug axxiom-s2] [--effective-date YYYY-MM-DD]
             [--corpus-dir <dir>] [--out-dir .ingest] [--expect-pages N] [--included-docs section-2]
  ingest inspect --version-id <id> --page N [--out-dir .ingest] [--raw]
  ingest publish --version-id <id> --pdf <file> [--force]        (needs DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  ingest approve --version-id <id> --by "<name>" [--note "..."]   (writes corpus/<slug>/<version>/review/approval.json)
  ingest activate --version-id <id>                               (needs DATABASE_URL)
`;

// pnpm forwards a literal "--" when invoked as `pnpm ingest -- run ...`; drop it so options still parse.
const args = process.argv.slice(2).filter((a, i, all) => !(a === "--" && all.indexOf("--") === i));

const { values, positionals } = parseArgs({
  args,
  allowPositionals: true,
  options: {
    pdf: { type: "string" },
    "version-id": { type: "string" },
    slug: { type: "string", default: "axxiom-s2" },
    "effective-date": { type: "string" },
    "corpus-dir": { type: "string" },
    "out-dir": { type: "string", default: ".ingest" },
    "expect-pages": { type: "string" },
    "included-docs": { type: "string", default: "section-2" },
    page: { type: "string" },
    raw: { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    by: { type: "string" },
    note: { type: "string" },
  },
});

// pnpm sets INIT_CWD to the directory the user ran the command from; use it as the repo root.
const repoRoot = process.env.INIT_CWD ?? process.cwd();
const resolve = (p: string) => (path.isAbsolute(p) ? p : path.join(repoRoot, p));

function require(name: "pdf" | "version-id" | "page"): string {
  const v = values[name];
  if (!v) {
    process.stderr.write(`Missing --${name}\n${USAGE}`);
    process.exit(2);
  }
  return v;
}

function corpusDirFor(versionId: string): string {
  const slug = values.slug ?? "axxiom-s2";
  const versionDir = versionId.startsWith(`${slug}-`)
    ? versionId.slice(slug.length + 1)
    : versionId;
  return resolve(values["corpus-dir"] ?? path.join("corpus", slug, versionDir));
}

async function main(): Promise<void> {
  const command = positionals[0];
  loadEnv(repoRoot);
  const outDir = resolve(values["out-dir"] ?? ".ingest");
  if (command === "publish") {
    const versionId = require("version-id");
    const result = await publishVersion({
      versionId,
      outDir,
      corpusDir: corpusDirFor(versionId),
      pdfPath: resolve(require("pdf")),
      force: values.force ?? false,
    });
    process.stdout.write(
      `published ${versionId}: ${result.pages} pages, ${result.sections} sections, storage ${result.storage_prefix}\n`,
    );
    return;
  }
  if (command === "approve") {
    const versionId = require("version-id");
    if (!values.by) {
      process.stderr.write("Missing --by\n");
      process.exit(2);
    }
    const approval = await writeApproval(
      corpusDirFor(versionId),
      versionId,
      outDir,
      values.by,
      values.note,
    );
    process.stdout.write(
      `approval written for ${versionId} (pages ${approval.pages_sha256.slice(0, 12)}...) by ${approval.approved_by}\n`,
    );
    return;
  }
  if (command === "activate") {
    const versionId = require("version-id");
    const result = await activateVersion(corpusDirFor(versionId), versionId);
    process.stdout.write(
      `${versionId} is now active${result.retired ? `; retired ${result.retired}` : ""}\n`,
    );
    return;
  }
  if (command === "run") {
    const versionId = require("version-id");
    const slug = values.slug ?? "axxiom-s2";
    const versionDir = versionId.startsWith(`${slug}-`)
      ? versionId.slice(slug.length + 1)
      : versionId;
    const corpusDir = resolve(values["corpus-dir"] ?? path.join("corpus", slug, versionDir));
    const result = await runIngest({
      pdf: resolve(require("pdf")),
      slug,
      versionId,
      effectiveDate: values["effective-date"] ?? null,
      corpusDir,
      outDir: resolve(values["out-dir"] ?? ".ingest"),
      expectPages: values["expect-pages"] ? Number(values["expect-pages"]) : null,
      includedDocs: (values["included-docs"] ?? "section-2")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      repoRoot,
    });
    for (const line of result.summary) process.stdout.write(`${line}\n`);
    for (const w of result.warnings) process.stdout.write(`warn: ${w}\n`);
    for (const p of result.problems) process.stderr.write(`PROBLEM: ${p}\n`);
    process.stdout.write(result.ok ? "OK\n" : `FAILED with ${result.problems.length} problem(s)\n`);
    process.exit(result.ok ? 0 : 1);
  }
  if (command === "inspect") {
    const versionId = require("version-id");
    const page = Number(require("page"));
    const file = path.join(
      resolve(values["out-dir"] ?? ".ingest"),
      versionId,
      values.raw ? "pages.raw.json" : "pages.blocks.json",
    );
    const pages = JSON.parse(await readFile(file, "utf8")) as (
      | BlockPage
      | { page_index: number; raw_text: string }
    )[];
    const found = pages.find((p) => p.page_index === page);
    if (!found) {
      process.stderr.write(`Page ${page} not found in ${file}\n`);
      process.exit(1);
    }
    process.stdout.write(`${"raw_text" in found ? found.raw_text : found.block_text}\n`);
    return;
  }
  process.stderr.write(USAGE);
  process.exit(2);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exit(1);
});
