import { readFileSync, writeFileSync } from "node:fs";
import type { EvalCase } from "./schema.ts";

const COLUMNS = [
  "id",
  "set",
  "status",
  "program",
  "subsection",
  "page",
  "question",
  "reference_answer",
  "supporting_quote",
  "decision",
  "corrected_answer",
  "notes",
] as const;

function csvCell(v: unknown): string {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV for the Safety Manager: fill `decision` with approve, edit (with corrected_answer) or reject. */
export function exportSheet(cases: EvalCase[], file: string): number {
  const rows = cases.map((c) =>
    [
      c.id,
      c.set,
      c.source.status,
      c.tags.program ?? "",
      c.expected.subsection_number ?? "",
      c.expected.page_range?.[0] ?? "",
      c.question,
      c.expected.reference_answer,
      c.expected.supporting_quote ?? "",
      "",
      "",
      c.notes ?? "",
    ]
      .map(csvCell)
      .join(","),
  );
  writeFileSync(file, `${COLUMNS.join(",")}\n${rows.join("\n")}\n`, "utf8");
  return rows.length;
}

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.length > 0)) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((c) => c.length > 0)) rows.push(row);
  }
  const header = rows.shift() ?? [];
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

export type ImportSummary = {
  approved: number;
  edited: number;
  rejected: number;
  untouched: number;
  unknown_ids: string[];
};

/** Applies decisions from the reviewed CSV to the cases (mutates and returns them). */
export function applySheet(cases: EvalCase[], csvFile: string, approvedBy: string): ImportSummary {
  const rows = parseCsv(readFileSync(csvFile, "utf8"));
  const byId = new Map(cases.map((c) => [c.id, c]));
  const summary: ImportSummary = {
    approved: 0,
    edited: 0,
    rejected: 0,
    untouched: 0,
    unknown_ids: [],
  };
  const today = new Date().toISOString().slice(0, 10);
  for (const row of rows) {
    const c = byId.get(row.id ?? "");
    if (!c) {
      if (row.id) summary.unknown_ids.push(row.id);
      continue;
    }
    const decision = (row.decision ?? "").trim().toLowerCase();
    if (decision === "approve") {
      c.source = {
        ...c.source,
        status: "safety-manager-approved",
        approved_by: approvedBy,
        approved_on: today,
      };
      summary.approved += 1;
    } else if (decision === "edit") {
      if (row.corrected_answer?.trim()) c.expected.reference_answer = row.corrected_answer.trim();
      if (row.question?.trim()) c.question = row.question.trim();
      c.source = {
        ...c.source,
        status: "safety-manager-approved",
        approved_by: approvedBy,
        approved_on: today,
      };
      summary.edited += 1;
    } else if (decision === "reject") {
      c.source = { ...c.source, status: "retired" };
      summary.rejected += 1;
    } else summary.untouched += 1;
    if (row.notes?.trim()) c.notes = row.notes.trim();
  }
  return summary;
}
