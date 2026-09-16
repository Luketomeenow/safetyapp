import type { Manifest } from "@axxiom/shared";
import type { ProgramSpan, SectionSpan } from "./structure.ts";
import type { TableCandidate, TableResult } from "./tables.ts";
import type { TocResult } from "./toc.ts";

export type ReportInput = {
  manifest: Manifest;
  toc: TocResult;
  programs: ProgramSpan[];
  sections: SectionSpan[];
  tables: TableResult[];
  candidates: TableCandidate[];
  problems: string[];
  warnings: string[];
};

function pos(p: { page: number; line: number }): string {
  return `p${p.page} L${p.line}`;
}

/** Markdown review document for the Safety Manager and the build team. */
export function renderReport(input: ReportInput): string {
  const { manifest, toc, programs, sections, tables, candidates, problems, warnings } = input;
  const out: string[] = [];
  out.push(`# Structure review: ${manifest.version_id}`);
  out.push("");
  out.push(
    `Generated ${manifest.created_at}. Source PDF sha256 \`${manifest.pdf_sha256}\`. ${manifest.page_count} pages; body starts on PDF page ${manifest.body_start_page} line ${manifest.body_start_line}. Effective date ${manifest.effective_date}.`,
  );
  out.push("");
  out.push("## Checks");
  out.push("");
  out.push("| Check | Status | Detail |");
  out.push("|---|---|---|");
  for (const [name, check] of Object.entries(manifest.checks)) {
    out.push(`| ${name} | ${check.status} | ${check.detail.replace(/\|/g, "\\|")} |`);
  }
  out.push("");
  if (problems.length > 0) {
    out.push("## Problems (must be fixed before publishing)");
    out.push("");
    for (const p of problems) out.push(`- ${p}`);
    out.push("");
  }
  if (warnings.length > 0) {
    out.push("## Warnings");
    out.push("");
    for (const w of warnings) out.push(`- ${w}`);
    out.push("");
  }
  out.push("## Programs");
  out.push("");
  out.push("TOC page numbers are printed for comparison only; citations use the PDF page.");
  out.push("");
  out.push("| # | Title | Policy ref | PDF pages | TOC says | Title match |");
  out.push("|---|---|---|---|---|---|");
  for (const pr of programs) {
    const hint = toc.programs.find((t) => t.program_number === pr.number)?.toc_page_hint ?? "?";
    out.push(
      `| ${pr.number} | ${pr.title} | ${pr.policy_ref ?? ""} | ${pr.start.page}-${pr.end.page} | ${hint} | ${pr.title_method} |`,
    );
  }
  out.push("");
  out.push("## Subsections");
  out.push("");
  for (const pr of programs) {
    out.push(`### Program ${pr.number}: ${pr.title} (PDF pages ${pr.start.page}-${pr.end.page})`);
    out.push("");
    out.push("| # | Title | Starts | Ends | Match |");
    out.push("|---|---|---|---|---|");
    for (const s of sections.filter((x) => x.level === 2 && x.program_number === pr.number)) {
      const method =
        s.match_method === "exact" ? "exact" : `${s.match_method} (${s.match_score.toFixed(2)})`;
      out.push(`| ${s.number ?? ""} | ${s.title} | ${pos(s.start)} | ${pos(s.end)} | ${method} |`);
    }
    out.push("");
  }
  out.push("## Tables rebuilt");
  out.push("");
  if (tables.length === 0) out.push("None registered.");
  for (const t of tables) {
    out.push(
      `### ${t.id} (PDF page${t.pages.length > 1 ? "s" : ""} ${t.pages.join(", ")}; ${t.rows.length} rows)`,
    );
    out.push("");
    out.push(t.markdown);
    out.push("");
  }
  out.push("## Unregistered table candidates");
  out.push("");
  out.push(
    "Runs of short consecutive lines that may be flattened tables. Add real tables to `tables.json`; ignore lists and revision-tracking templates.",
  );
  out.push("");
  if (candidates.length === 0) out.push("None.");
  for (const c of candidates) {
    out.push(
      `- PDF page ${c.page}, lines ${c.from}-${c.to}: ${c.sample.map((s) => JSON.stringify(s)).join(", ")}${c.to - c.from + 1 > c.sample.length ? ", ..." : ""}`,
    );
  }
  out.push("");
  return out.join("\n");
}
