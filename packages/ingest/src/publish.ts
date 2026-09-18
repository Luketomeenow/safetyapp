import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { type Manifest, ManifestSchema } from "@axxiom/shared";
import type { BlockPage } from "./blocks.ts";
import { connectDb, storageClient } from "./db.ts";
import type { RawPage } from "./extract.ts";

export type PublishOptions = {
  versionId: string;
  outDir: string;
  corpusDir: string;
  pdfPath: string;
  force: boolean;
};

const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

/**
 * Uploads the PDF, Markdown and manifest to the private `manuals` bucket and writes the version,
 * pages and sections to Postgres in one transaction. The version is created as `draft`; `activate`
 * makes it live. Re-publishing a non-active version replaces its rows when --force is given.
 */
export async function publishVersion(
  o: PublishOptions,
): Promise<{ pages: number; sections: number; storage_prefix: string }> {
  const dir = path.join(o.outDir, o.versionId);
  const manifest: Manifest = ManifestSchema.parse(
    JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")),
  );
  const blocks = JSON.parse(
    await readFile(path.join(dir, "pages.blocks.json"), "utf8"),
  ) as BlockPage[];
  const raw = JSON.parse(await readFile(path.join(dir, "pages.raw.json"), "utf8")) as RawPage[];
  const manualMd = await readFile(path.join(dir, "manual.md"));
  const pdf = await readFile(o.pdfPath);
  if (sha256(pdf) !== manifest.pdf_sha256) {
    throw new Error(`PDF at ${o.pdfPath} does not match manifest pdf_sha256; re-run ingest`);
  }
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "manuals";
  const prefix = `${manifest.document_slug}/${o.versionId}`;
  const storage = storageClient().storage.from(bucket);
  const uploads: [string, Buffer, string][] = [
    [`${prefix}/source.pdf`, pdf, "application/pdf"],
    [`${prefix}/manual.md`, manualMd, "text/markdown"],
    [`${prefix}/manifest.json`, Buffer.from(JSON.stringify(manifest, null, 2)), "application/json"],
  ];
  for (const [key, body, contentType] of uploads) {
    const { error } = await storage.upload(key, body, { contentType, upsert: true });
    if (error) throw new Error(`Storage upload failed for ${key}: ${error.message}`);
  }

  const sql = connectDb();
  try {
    const rawByPage = new Map(raw.map((p) => [p.page_index, p.raw_text]));
    const result = await sql.begin(async (tx) => {
      const [existing] = await tx<
        { status: string }[]
      >`select status from manual_versions where id = ${o.versionId}`;
      if (existing) {
        if (existing.status === "active")
          throw new Error(`${o.versionId} is active; publish a new version instead`);
        if (!o.force)
          throw new Error(
            `${o.versionId} already exists with status ${existing.status}; use --force to replace it`,
          );
        await tx`delete from manual_versions where id = ${o.versionId}`;
      }
      const [doc] = await tx<{ id: string }[]>`
        insert into documents (slug, title, doc_kind, precedence)
        values (${manifest.document_slug}, ${"Axxiom Elevator Safety and Health Policies, Section 2: Specific Safety Policies"}, 'manual', 10)
        on conflict (slug) do update set title = excluded.title
        returning id`;
      if (!doc) throw new Error("document upsert returned no row");
      await tx`
        insert into manual_versions (id, document_id, effective_date, status, page_count, body_start_page,
          pdf_storage_path, md_storage_path, manifest_storage_path, pdf_sha256, pages_sha256, size_bytes,
          token_count, tooling, manifest)
        values (${o.versionId}, ${doc.id}, ${manifest.effective_date}, 'draft', ${manifest.page_count}, ${manifest.body_start_page},
          ${`${prefix}/source.pdf`}, ${`${prefix}/manual.md`}, ${`${prefix}/manifest.json`}, ${manifest.pdf_sha256}, ${manifest.pages_sha256},
          ${manifest.size_bytes}, ${manifest.token_count}, ${tx.json(manifest.tooling)}, ${tx.json(manifest)})`;
      const pageRows = blocks.map((b) => ({
        manual_version_id: o.versionId,
        page_index: b.page_index,
        is_toc: b.is_toc,
        raw_text: rawByPage.get(b.page_index) ?? "",
        model_text: b.model_text,
        block_text: b.block_text,
        char_count: b.block_text.length,
        sha256: sha256(b.block_text),
      }));
      for (let i = 0; i < pageRows.length; i += 50) {
        await tx`insert into manual_pages ${tx(pageRows.slice(i, i + 50))}`;
      }
      const programRef = new Map(manifest.programs.map((p) => [p.number, p.policy_ref]));
      const sectionRows = manifest.sections.map((s) => ({
        manual_version_id: o.versionId,
        number: s.number,
        level: s.level,
        title: s.title,
        program_number: s.program_number,
        policy_ref: s.level === 1 ? (programRef.get(s.program_number) ?? null) : null,
        start_page: s.start_page,
        start_line: s.start_line,
        end_page: s.end_page,
        end_line: s.end_line,
        match_method: s.match_method,
        match_score: s.match_score,
        toc_page_hint: s.toc_page_hint,
      }));
      for (let i = 0; i < sectionRows.length; i += 100) {
        await tx`insert into manual_sections ${tx(sectionRows.slice(i, i + 100))}`;
      }
      return { pages: pageRows.length, sections: sectionRows.length };
    });
    return { ...result, storage_prefix: `${bucket}/${prefix}` };
  } finally {
    await sql.end();
  }
}
