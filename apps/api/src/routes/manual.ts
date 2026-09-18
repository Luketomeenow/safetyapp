import { Hono } from "hono";
import { getSql, getStorage } from "../deps.ts";
import { type AuthedUser, requireUser } from "../middleware/auth.ts";

export const manual = new Hono<{ Variables: { user: AuthedUser } }>();

manual.get("/current", requireUser, async (c) => {
  const sql = getSql();
  const [v] = await sql<
    {
      id: string;
      effective_date: string;
      page_count: number;
      body_start_page: number;
      pdf_storage_path: string;
      pdf_sha256: string;
      pages_sha256: string;
      size_bytes: number;
      manifest: {
        programs: { number: number; title: string; start_page: number; end_page: number }[];
        sections: { number: string | null; level: number; title: string; start_page: number }[];
      };
    }[]
  >`
    select id, to_char(effective_date, 'YYYY-MM-DD') as effective_date, page_count, body_start_page, pdf_storage_path, pdf_sha256, pages_sha256, size_bytes, manifest
    from manual_versions where status = 'active' order by activated_at desc limit 1`;
  if (!v) return c.json({ code: "manual_unavailable", message: "No active manual" }, 503);
  const { data, error } = await getStorage().createSignedUrl(v.pdf_storage_path, 3600);
  if (error || !data)
    return c.json(
      { code: "internal", message: `signed url failed: ${error?.message ?? "unknown"}` },
      500,
    );
  return c.json({
    version_id: v.id,
    effective_date: v.effective_date,
    page_count: v.page_count,
    body_start_page: v.body_start_page,
    pdf_sha256: v.pdf_sha256,
    pages_sha256: v.pages_sha256,
    size_bytes: Number(v.size_bytes),
    pdf_url: data.signedUrl,
    programs: v.manifest.programs.map((p) => ({
      number: p.number,
      title: p.title,
      start_page: p.start_page,
      end_page: p.end_page,
    })),
    sections: v.manifest.sections
      .filter((s) => s.level === 2 && s.number)
      .map((s) => ({ number: s.number as string, title: s.title, start_page: s.start_page })),
  });
});
