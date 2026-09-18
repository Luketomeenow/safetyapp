import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { type LoadedManual, resolveSection } from "@axxiom/core";
import { normalizeForMatch, tokenSet } from "@axxiom/shared";
import { z } from "zod";
import { DATA_DIR, readJsonl } from "./load.ts";
import { type EvalCase, Hazard } from "./schema.ts";

export const DRAFT_MODEL = process.env.JUDGE_MODEL ?? "claude-sonnet-5";
const NON_NEGOTIABLE = new Set([8, 9, 12, 19, 20]);
const MEDIUM = new Set([3, 5, 6, 7, 10, 11, 13, 14, 15, 16, 17, 22, 24]);

export function quotaFor(program: number): number {
  if (NON_NEGOTIABLE.has(program)) return 8;
  if (MEDIUM.has(program)) return 4;
  return 3;
}

const DraftSchema = z.object({
  cases: z.array(
    z.object({
      question: z.string(),
      reference_answer: z.string(),
      supporting_quote: z.string(),
      page: z.number().int(),
      subsection_number: z.string(),
      hazard: z.string(),
      difficulty: z.enum(["easy", "medium", "hard"]),
      question_type: z.enum(["rule", "threshold", "procedure_step", "responsibility", "condition"]),
    }),
  ),
});

const DRAFT_SYSTEM = `You write evaluation questions for an internal safety assistant used by elevator technicians. You receive the full text of one program from the company's Safety and Health Policies manual, one block per PDF page, each starting with a header "[Page P of 209 | Program N: Title | subsections]".

Write questions a field technician would actually ask in plain words (short, sometimes informal, no policy jargon), each answerable from this program alone. Spread them across the listed question types and across the program's subsections (at most two per subsection). Avoid questions about emergencies happening now.

For each question give:
- reference_answer: two to five sentences, using only this program's text, stating conditions and when to check with a supervisor.
- supporting_quote: a verbatim passage of at most 40 words copied exactly from one page (keep its capitalization, punctuation and typos; never copy the page header line).
- page: the PDF page number from the header of the page the quote is on.
- subsection_number: the subsection (like "8.4") from that page's header that the quote belongs to.
- hazard: one of hazardous-energy, fall, hoistway-pit, confined-space, jumper, electrical, heat, chemical, ppe, rigging, vehicle, biological, noise, admin, other.
- difficulty: easy (one clear sentence answers it), medium (needs a condition), hard (needs two passages or a threshold).`;

function jaccard(a: string, b: string): number {
  const A = tokenSet(normalizeForMatch(a));
  const B = tokenSet(normalizeForMatch(b));
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter || 1);
}

export type DraftSummary = {
  program: number;
  requested: number;
  produced: number;
  kept: number;
  dropped: string[];
  cost_usd: number;
};

export async function draftProgram(
  client: Anthropic,
  manual: LoadedManual,
  program: number,
  existing: EvalCase[],
): Promise<{ cases: EvalCase[]; summary: DraftSummary }> {
  const prog = manual.programs.find((p) => p.number === program);
  if (!prog) throw new Error(`program ${program} not found`);
  const pages = manual.pages.filter(
    (p) => p.page_index >= prog.start_page && p.page_index <= prog.end_page,
  );
  const subsections = manual.sections
    .filter((s) => s.level === 2 && s.program_number === program)
    .map((s) => `${s.number} ${s.title}`);
  const quota = quotaFor(program);
  const response = await client.messages.parse({
    model: DRAFT_MODEL,
    max_tokens: 8000,
    system: DRAFT_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Program ${program}: ${prog.title}\nSubsections: ${subsections.join("; ")}\n\nWrite exactly ${quota} cases.\n\n${pages.map((p) => p.block_text).join("\n\n")}`,
      },
    ],
    output_config: { effort: "medium", format: zodOutputFormat(DraftSchema) },
  });
  const usage = response.usage;
  const cost = ((usage.input_tokens ?? 0) * 2 + (usage.output_tokens ?? 0) * 10) / 1_000_000;
  const produced = response.parsed_output?.cases ?? [];
  const dropped: string[] = [];
  const kept: EvalCase[] = [];
  const programSections = manual.sections.filter(
    (s) => s.level === 2 && s.program_number === program,
  );
  let seq = existing.filter((c) => c.tags.program === program).length;
  for (const d of produced) {
    const q = normalizeForMatch(d.supporting_quote);
    let page = d.page;
    if (!(manual.normalizedPages.get(page) ?? "").includes(q)) {
      const alt = pages.find((p) => (manual.normalizedPages.get(p.page_index) ?? "").includes(q));
      if (!alt) {
        dropped.push(`quote not found: "${d.supporting_quote.slice(0, 60)}"`);
        continue;
      }
      page = alt.page_index;
    }
    if (
      existing.some((c) => jaccard(c.question, d.question) > 0.6) ||
      kept.some((c) => jaccard(c.question, d.question) > 0.6)
    ) {
      dropped.push(`near-duplicate: "${d.question.slice(0, 60)}"`);
      continue;
    }
    const section =
      programSections.find((s) => s.number === d.subsection_number) ?? resolveSection(manual, page);
    const subsection = section?.level === 2 ? (section.number ?? undefined) : undefined;
    const hazard = Hazard.safeParse(d.hazard).success
      ? (d.hazard as z.infer<typeof Hazard>)
      : "other";
    seq += 1;
    const subIdx = String(subsection ?? "0").split(".")[1] ?? "0";
    kept.push({
      id: `G-${String(program).padStart(2, "0")}-${subIdx.padStart(3, "0")}-${String(seq).padStart(2, "0")}`,
      set: "golden",
      question: d.question,
      expected: {
        behavior: "answer",
        program_number: program,
        ...(subsection ? { subsection_number: subsection } : {}),
        page_range: [page, page],
        reference_answer: d.reference_answer,
        supporting_quote: d.supporting_quote,
        emergency_expected: false,
      },
      tags: {
        program,
        hazard,
        non_negotiable: NON_NEGOTIABLE.has(program),
        difficulty: d.difficulty,
        language: "en",
      },
      group: { group_id: `G-${program}-${seq}`, variant_kind: "canonical" },
      source: { status: "draft", origin: "seed-llm" },
      notes: `question_type=${d.question_type}; drafted by ${DRAFT_MODEL}`,
    });
  }
  return {
    cases: kept,
    summary: {
      program,
      requested: quota,
      produced: produced.length,
      kept: kept.length,
      dropped,
      cost_usd: cost,
    },
  };
}

export function appendInbox(file: string, cases: EvalCase[]): void {
  mkdirSync(path.dirname(file), { recursive: true });
  for (const c of cases) appendFileSync(file, `${JSON.stringify(c)}\n`);
}

export function readInbox(file: string): EvalCase[] {
  return existsSync(file) ? (readJsonl(file) as EvalCase[]) : [];
}

export const INBOX_GOLDEN = path.join(DATA_DIR, "inbox", "golden-seed.jsonl");
export { readFileSync };
