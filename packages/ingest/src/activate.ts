import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { connectDb } from "./db.ts";

export const ApprovalSchema = z.object({
  version_id: z.string(),
  pages_sha256: z.string().length(64),
  approved_by: z.string().min(1),
  approved_at: z.string(),
  note: z.string().optional(),
});
export type Approval = z.infer<typeof ApprovalSchema>;

/** Records the Safety Manager's (or, in development, Luke's) approval of the reviewed pages. */
export async function writeApproval(
  corpusDir: string,
  versionId: string,
  outDir: string,
  by: string,
  note?: string,
): Promise<Approval> {
  const manifest = JSON.parse(
    await readFile(path.join(outDir, versionId, "manifest.json"), "utf8"),
  ) as { pages_sha256: string };
  const approval: Approval = {
    version_id: versionId,
    pages_sha256: manifest.pages_sha256,
    approved_by: by,
    approved_at: new Date().toISOString(),
    ...(note ? { note } : {}),
  };
  await writeFile(
    path.join(corpusDir, "review", "approval.json"),
    `${JSON.stringify(approval, null, 2)}\n`,
    "utf8",
  );
  return approval;
}

/** Makes a published version active (retiring the previous one) if the approval matches its pages. */
export async function activateVersion(
  corpusDir: string,
  versionId: string,
): Promise<{ retired: string | null }> {
  const approval = ApprovalSchema.parse(
    JSON.parse(await readFile(path.join(corpusDir, "review", "approval.json"), "utf8")),
  );
  if (approval.version_id !== versionId)
    throw new Error(`approval.json is for ${approval.version_id}, not ${versionId}`);
  const sql = connectDb();
  try {
    return await sql.begin(async (tx) => {
      const [row] = await tx<{ status: string; pages_sha256: string; document_id: string }[]>`
        select status, pages_sha256, document_id from manual_versions where id = ${versionId}`;
      if (!row) throw new Error(`${versionId} has not been published`);
      if (row.pages_sha256 !== approval.pages_sha256)
        throw new Error(
          "approval.json pages_sha256 does not match the published version; review the current pages and approve again",
        );
      const [previous] = await tx<{ id: string }[]>`
        update manual_versions set status = 'retired', retired_at = now()
        where document_id = ${row.document_id} and status = 'active' and id <> ${versionId} returning id`;
      await tx`update manual_versions set status = 'active', activated_at = now(), approval = ${tx.json(approval)} where id = ${versionId}`;
      return { retired: previous?.id ?? null };
    });
  } finally {
    await sql.end();
  }
}
