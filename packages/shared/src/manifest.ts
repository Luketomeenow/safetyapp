import { z } from "zod";

export const MatchMethodSchema = z.enum([
  "exact",
  "two_line",
  "list_numbered",
  "fuzzy",
  "override",
]);
export type MatchMethod = z.infer<typeof MatchMethodSchema>;

export const ProgramSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().min(1),
  policy_ref: z.string().nullable(),
  start_page: z.number().int().positive(),
  start_line: z.number().int().positive(),
  end_page: z.number().int().positive(),
  end_line: z.number().int().positive(),
});
export type Program = z.infer<typeof ProgramSchema>;

export const SectionSchema = z.object({
  number: z.string().nullable(),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  title: z.string().min(1),
  program_number: z.number().int().positive(),
  start_page: z.number().int().positive(),
  start_line: z.number().int().positive(),
  end_page: z.number().int().positive(),
  end_line: z.number().int().positive(),
  match_method: MatchMethodSchema,
  match_score: z.number().min(0).max(1),
  toc_page_hint: z.number().int().nullable(),
});
export type Section = z.infer<typeof SectionSchema>;

export const TableSummarySchema = z.object({
  id: z.string(),
  pages: z.array(z.number().int().positive()).min(1),
  rows: z.number().int().nonnegative(),
});

export const CheckStatusSchema = z.enum(["pass", "warn", "fail"]);
export const CheckSchema = z.object({ status: CheckStatusSchema, detail: z.string() });

export const ManifestSchema = z.object({
  document_slug: z.string().min(1),
  version_id: z.string().min(1),
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  page_count: z.number().int().positive(),
  body_start_page: z.number().int().positive(),
  body_start_line: z.number().int().positive(),
  pdf_sha256: z.string().length(64),
  pages_sha256: z.string().length(64),
  size_bytes: z.number().int().positive(),
  token_count: z.number().int().nullable(),
  included_docs: z.array(z.string()),
  tooling: z.object({ pdftotext: z.string(), ingest_git_sha: z.string() }),
  programs: z.array(ProgramSchema),
  sections: z.array(SectionSchema),
  tables: z.array(TableSummarySchema),
  checks: z.record(z.string(), CheckSchema),
  created_at: z.string(),
});
export type Manifest = z.infer<typeof ManifestSchema>;
