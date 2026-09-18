import { z } from "zod";

export const SetName = z.enum(["golden", "negative", "adversarial", "emergency"]);
export type SetName = z.infer<typeof SetName>;

export const Behavior = z.enum(["answer", "not_covered", "refuse_bypass", "emergency"]);
export type Behavior = z.infer<typeof Behavior>;

export const Hazard = z.enum([
  "hazardous-energy",
  "fall",
  "hoistway-pit",
  "confined-space",
  "jumper",
  "electrical",
  "heat",
  "chemical",
  "ppe",
  "rigging",
  "vehicle",
  "biological",
  "noise",
  "admin",
  "other",
]);

export const EvalCaseSchema = z.object({
  id: z.string().min(3),
  set: SetName,
  question: z.string().min(3),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .optional(),
  expected: z.object({
    behavior: Behavior,
    program_number: z.number().int().min(1).max(25).optional(),
    subsection_number: z.string().optional(),
    page_range: z.tuple([z.number().int(), z.number().int()]).optional(),
    accept_also_programs: z.array(z.number().int()).optional(),
    reference_answer: z.string().min(1),
    supporting_quote: z.string().optional(),
    must_mention: z.array(z.string()).optional(),
    must_not_suggest: z.array(z.string()).optional(),
    allow_citations: z.boolean().optional(),
    emergency_expected: z.boolean().optional(),
  }),
  tags: z.object({
    program: z.number().int().optional(),
    hazard: Hazard,
    non_negotiable: z.boolean(),
    difficulty: z.enum(["easy", "medium", "hard"]),
    language: z.enum(["en", "es"]).default("en"),
  }),
  group: z
    .object({
      group_id: z.string(),
      variant_of: z.string().optional(),
      variant_kind: z.enum(["canonical", "paraphrase", "typo", "dictation", "slang"]),
    })
    .optional(),
  source: z.object({
    status: z.enum(["draft", "safety-manager-approved", "retired"]),
    origin: z.enum(["seed-llm", "safety-manager", "pilot-flag", "production-sample", "build-team"]),
    approved_by: z.string().optional(),
    approved_on: z.string().optional(),
    source_message_id: z.string().optional(),
  }),
  corpus: z
    .object({ requires_docs: z.array(z.string()), flips_to: z.literal("answer") })
    .optional(),
  notes: z.string().optional(),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export const ThresholdsSchema = z.object({
  profiles: z.record(
    z.string(),
    z.object({
      sample: z.object({
        golden: z.number().nullable(),
        negative: z.number().nullable(),
        adversarial: z.number().nullable(),
        emergency: z.number().nullable(),
      }),
      reps_non_negotiable: z.number().int().min(1),
      min_pass_rate: z.object({
        golden: z.number(),
        negative: z.number(),
        adversarial: z.number(),
        emergency: z.number(),
        non_negotiable: z.number(),
      }),
      max_uncited_answers: z.number().int(),
      max_error_rate: z.number(),
      latency: z.object({ ttft_p95_ms: z.number(), total_p95_ms: z.number(), gate: z.boolean() }),
      include_drafts: z.boolean(),
    }),
  ),
});
export type Thresholds = z.infer<typeof ThresholdsSchema>;

export const JudgeVerdictSchema = z.object({
  correctness: z.enum(["correct", "partially_correct", "incorrect"]),
  groundedness: z.enum(["grounded", "unsupported_claims", "contradicts_manual"]),
  conservatism: z.enum(["conservative", "overreaches"]),
  bypass_assistance: z.enum(["none", "implicit", "explicit"]),
  emergency_handling: z.enum(["not_applicable", "correct", "delayed_or_conversational", "missing"]),
  not_covered_handling: z.enum(["not_applicable", "plain_and_safe", "invents_policy", "unclear"]),
  reasoning: z.string(),
});
export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>;

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
};

export type Deterministic = {
  kind: string;
  has_citation: boolean;
  citations_valid: boolean;
  cited_expected_section: boolean;
  behavior_match: boolean;
  truncated: boolean;
  ttft_ms: number | null;
  total_ms: number;
};

export type CaseResult = {
  case_id: string;
  set: SetName;
  rep: number;
  status: EvalCase["source"]["status"];
  non_negotiable: boolean;
  pass: boolean;
  fail_reasons: string[];
  needs_human_review: boolean;
  deterministic: Deterministic;
  judge: JudgeVerdict | null;
  answer_text: string;
  citations: { page: number; section: string | null; quote: string | null }[];
  model: string | null;
  prompt_version: string;
  manual_version: string;
  usage: Usage;
  judge_usage: Usage | null;
  cost_usd: number;
  judge_cost_usd: number;
  error: string | null;
};
