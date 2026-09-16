import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { type Manifest, ManifestSchema, toModelText } from "@axxiom/shared";
import { type BlockPage, buildBlocks } from "./blocks.ts";
import { extractPages } from "./extract.ts";
import { renderReport } from "./report.ts";
import { detectStructure, type Override } from "./structure.ts";
import { applyTables, detectTableCandidates, reconstructTables, type TableSpec } from "./tables.ts";
import { parseToc } from "./toc.ts";
import type { PageLines } from "./types.ts";

export type RunOptions = {
  pdf: string;
  slug: string;
  versionId: string;
  effectiveDate: string | null;
  corpusDir: string;
  outDir: string;
  expectPages: number | null;
  includedDocs: string[];
  repoRoot: string;
};

export type RunResult = {
  ok: boolean;
  manifest: Manifest;
  blocks: BlockPage[];
  problems: string[];
  warnings: string[];
  summary: string[];
};

type Check = Manifest["checks"][string];
const pass = (detail: string): Check => ({ status: "pass", detail });
const warn = (detail: string): Check => ({ status: "warn", detail });
const fail = (detail: string): Check => ({ status: "fail", detail });

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

async function readJsonIfExists<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

function gitSha(cwd: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "uncommitted";
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** Runs every ingestion step in memory, writes the artifacts, and returns the manifest plus problems. */
export async function runIngest(o: RunOptions): Promise<RunResult> {
  const problems: string[] = [];
  const warnings: string[] = [];
  const checks: Record<string, Check> = {};

  const extracted = await extractPages(o.pdf);
  const pdfBytes = await readFile(o.pdf);
  const modelPages: PageLines[] = extracted.pages.map((p) => ({
    page_index: p.page_index,
    lines: toModelText(p.raw_text).split("\n"),
  }));
  if (o.expectPages !== null && o.expectPages !== modelPages.length) {
    const msg = `Expected ${o.expectPages} pages, extracted ${modelPages.length}`;
    problems.push(msg);
    checks.page_count = fail(msg);
  } else {
    checks.page_count = pass(
      `${modelPages.length} pages (pdfinfo reports ${extracted.pdfinfo_pages})`,
    );
  }

  const toc = parseToc(modelPages);
  problems.push(...toc.problems);
  checks.toc =
    toc.problems.length > 0
      ? fail(toc.problems.join("; "))
      : pass(
          `${toc.programs.length} programs and ${toc.subsections.length} subsections listed; body starts page ${toc.body_start_page} line ${toc.body_start_line}`,
        );

  const specs = await readJsonIfExists<TableSpec[]>(path.join(o.corpusDir, "tables.json"), []);
  const overrides = await readJsonIfExists<Override[]>(
    path.join(o.corpusDir, "overrides.json"),
    [],
  );
  const tableResult = reconstructTables(modelPages, specs);
  problems.push(...tableResult.problems);
  const pagesWithTables = applyTables(modelPages, tableResult.tables);
  const candidates = detectTableCandidates(
    modelPages,
    tableResult.tables.flatMap((t) => t.consumed),
    { fromPage: toc.body_start_page },
  );
  checks.tables =
    tableResult.problems.length > 0
      ? fail(tableResult.problems.join("; "))
      : pass(
          `${tableResult.tables.length}/${specs.length} registered tables rebuilt; ${candidates.length} unregistered candidate runs to review`,
        );

  const structure = detectStructure(pagesWithTables, toc, overrides);
  problems.push(...structure.problems);
  warnings.push(...structure.warnings);
  const programProblems = structure.problems.filter(
    (p) => /program|reference lines/i.test(p) && !/subsection/i.test(p),
  );
  checks.programs =
    programProblems.length > 0
      ? fail(programProblems.join("; "))
      : pass(`${structure.programs.length}/${toc.programs.length} programs located in TOC order`);
  const level2 = structure.sections.filter((s) => s.level === 2);
  const byMethod = new Map<string, number>();
  for (const s of level2) byMethod.set(s.match_method, (byMethod.get(s.match_method) ?? 0) + 1);
  const methodSummary = [...byMethod.entries()].map(([m, n]) => `${m} ${n}`).join(", ");
  const unmatched = structure.problems.filter((p) => /not found/.test(p));
  checks.subsections =
    unmatched.length > 0
      ? fail(
          `${level2.length}/${toc.subsections.length} matched (${methodSummary}); ${unmatched.length} missing`,
        )
      : pass(`${level2.length}/${toc.subsections.length} matched (${methodSummary})`);
  const coverage = structure.problems.filter((p) => /not covered|same line/.test(p));
  checks.page_coverage =
    coverage.length > 0
      ? fail(coverage.join("; "))
      : pass("every body page belongs to at least one section; section starts are distinct");

  const blocks = buildBlocks(pagesWithTables, toc, structure.programs, structure.sections);
  const emptyBlocks = blocks
    .filter((b) => !b.is_toc && b.model_text.length === 0)
    .map((b) => b.page_index);
  if (emptyBlocks.length > 0) {
    problems.push(`Empty body blocks on pages ${emptyBlocks.join(", ")}`);
    checks.blocks = fail(`empty body blocks: ${emptyBlocks.join(", ")}`);
  } else {
    checks.blocks = pass(
      `${blocks.length} blocks; ${blocks.filter((b) => b.is_toc).length} TOC placeholders`,
    );
  }

  let effectiveDate = o.effectiveDate;
  if (effectiveDate) {
    checks.effective_date = pass(effectiveDate);
  } else {
    effectiveDate = today();
    checks.effective_date = warn(
      `no --effective-date given; assumed ${effectiveDate}. Confirm with the Safety Manager before publishing`,
    );
  }

  const manifest: Manifest = {
    document_slug: o.slug,
    version_id: o.versionId,
    effective_date: effectiveDate,
    page_count: modelPages.length,
    body_start_page: toc.body_start_page,
    body_start_line: toc.body_start_line,
    pdf_sha256: sha256(pdfBytes),
    pages_sha256: sha256(blocks.map((b) => b.block_text).join("\f")),
    size_bytes: pdfBytes.byteLength,
    token_count: null,
    included_docs: o.includedDocs,
    tooling: { pdftotext: extracted.pdftotext_version, ingest_git_sha: gitSha(o.repoRoot) },
    programs: structure.programs.map((p) => ({
      number: p.number,
      title: p.title,
      policy_ref: p.policy_ref,
      start_page: p.start.page,
      start_line: p.start.line,
      end_page: p.end.page,
      end_line: p.end.line,
    })),
    sections: structure.sections.map((s) => ({
      number: s.number,
      level: s.level,
      title: s.title,
      program_number: s.program_number,
      start_page: s.start.page,
      start_line: s.start.line,
      end_page: s.end.page,
      end_line: s.end.line,
      match_method: s.match_method,
      match_score: s.match_score,
      toc_page_hint: s.toc_page_hint,
    })),
    tables: tableResult.tables.map((t) => ({ id: t.id, pages: t.pages, rows: t.rows.length })),
    checks,
    created_at: new Date().toISOString(),
  };
  ManifestSchema.parse(manifest);

  const outVersionDir = path.join(o.outDir, o.versionId);
  const reviewDir = path.join(o.corpusDir, "review");
  await mkdir(outVersionDir, { recursive: true });
  await mkdir(reviewDir, { recursive: true });
  const manualMd = blocks.map((b) => `<!-- page ${b.page_index} -->\n${b.block_text}\n`).join("\n");
  const report = renderReport({
    manifest,
    toc,
    programs: structure.programs,
    sections: structure.sections,
    tables: tableResult.tables,
    candidates,
    problems,
    warnings,
  });
  await Promise.all([
    writeJson(path.join(outVersionDir, "pages.raw.json"), extracted.pages),
    writeJson(path.join(outVersionDir, "toc.json"), toc),
    writeJson(path.join(outVersionDir, "pages.model.json"), pagesWithTables),
    writeJson(path.join(outVersionDir, "tables.json"), tableResult.tables),
    writeJson(path.join(outVersionDir, "structure.json"), {
      programs: structure.programs,
      sections: structure.sections,
    }),
    writeJson(path.join(outVersionDir, "pages.blocks.json"), blocks),
    writeFile(path.join(outVersionDir, "manual.md"), manualMd, "utf8"),
    writeJson(path.join(outVersionDir, "manifest.json"), manifest),
    writeJson(path.join(o.corpusDir, "manifest.json"), manifest),
    writeFile(path.join(reviewDir, "structure.md"), report, "utf8"),
  ]);

  const summary = Object.entries(checks).map(
    ([name, c]) => `${c.status.padEnd(4)} ${name}: ${c.detail}`,
  );
  summary.push(
    `artifacts: ${outVersionDir}`,
    `manifest: ${path.join(o.corpusDir, "manifest.json")}`,
    `review: ${path.join(reviewDir, "structure.md")}`,
  );
  return { ok: problems.length === 0, manifest, blocks, problems, warnings, summary };
}
