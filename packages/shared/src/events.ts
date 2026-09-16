import { z } from "zod";

/** How the API classified a completed turn. */
export const ResponseKindSchema = z.enum([
  "answer",
  "not_covered",
  "out_of_scope",
  "emergency",
  "refusal",
  "validation_failed",
  "error",
]);
export type ResponseKind = z.infer<typeof ResponseKindSchema>;

export const ErrorCodeSchema = z.enum([
  "rate_limited",
  "unauthorized",
  "upstream_unavailable",
  "conversation_closed",
  "manual_unavailable",
  "internal",
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

const ProgramRefSchema = z.object({ number: z.number().int(), title: z.string() });
const SectionRefSchema = z.object({ number: z.string().nullable(), title: z.string() });

export const CitationRefSchema = z.object({
  id: z.string(),
  page: z.number().int().positive(),
  program: ProgramRefSchema.nullable(),
  section: SectionRefSchema.nullable(),
});
export type CitationRef = z.infer<typeof CitationRefSchema>;

export const DoneCitationSchema = CitationRefSchema.extend({ quote: z.string().nullable() });
export type DoneCitation = z.infer<typeof DoneCitationSchema>;

export const StatusEventSchema = z.object({
  stage: z.enum(["reading_manual", "writing", "verifying"]),
});
export const TextEventSchema = z.object({ delta: z.string() });
export const EmergencyEventSchema = z.object({
  headline: z.string(),
  steps: z.array(z.string()),
  call: z.object({ label: z.string(), tel: z.string() }),
  contacts: z.array(z.object({ label: z.string(), tel: z.string() })),
  citations: z.array(z.object({ page: z.number().int(), section: z.string() })),
});
export const ReplaceEventSchema = z.object({
  text: z.string(),
  reason: z.enum(["validation_failed", "refusal", "truncated"]),
});
export const UsageSchema = z.object({
  input_tokens: z.number().int(),
  output_tokens: z.number().int(),
  cache_read_input_tokens: z.number().int(),
  cache_creation_input_tokens: z.number().int(),
});
export const DoneEventSchema = z.object({
  message_id: z.string(),
  conversation_id: z.string(),
  client_message_id: z.string().nullable(),
  kind: ResponseKindSchema,
  stop_reason: z.string().nullable(),
  truncated: z.boolean(),
  validation: z.object({
    passed: z.boolean(),
    problems: z.array(z.string()),
    quotes_verified: z.boolean(),
  }),
  citations: z.array(DoneCitationSchema),
  manual: z.object({ version_id: z.string(), effective_date: z.string() }),
  usage: UsageSchema,
  timing: z.object({ ttft_ms: z.number().nullable(), total_ms: z.number() }),
});
export const ErrorEventSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  retryable: z.boolean(),
});

export type ChatEvent =
  | { event: "status"; data: z.infer<typeof StatusEventSchema> }
  | { event: "text"; data: z.infer<typeof TextEventSchema> }
  | { event: "citation"; data: CitationRef }
  | { event: "emergency"; data: z.infer<typeof EmergencyEventSchema> }
  | { event: "replace"; data: z.infer<typeof ReplaceEventSchema> }
  | { event: "done"; data: z.infer<typeof DoneEventSchema> }
  | { event: "error"; data: z.infer<typeof ErrorEventSchema> };

/** Wire framing for one server-sent event. */
export function formatSse(event: ChatEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}
