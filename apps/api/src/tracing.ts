import type { Tracer, TraceSpan } from "@axxiom/core";
import type { ChatEvent } from "@axxiom/shared";
import { propagateAttributes, startActiveObservation, startObservation } from "@langfuse/tracing";
import { captureError, flushTelemetry, pseudonymousUserId, telemetryEnabled } from "./telemetry.ts";

export { captureError, flushTelemetry, pseudonymousUserId, telemetryEnabled };

export type TraceInput = {
  userId: string;
  sessionId: string | null;
  promptVersion: string;
  clientVersion: string | null;
  requestId: string | null;
};

type DoneData = Extract<ChatEvent, { event: "done" }>["data"];

/**
 * Tracing is metadata-only by default: question and answer text stay in the database, which is the
 * record of truth, and never reach the tracing vendor. Set LANGFUSE_INCLUDE_TEXT=true in a
 * non-production environment when a specific answer has to be debugged.
 */
const includeText = (): boolean =>
  process.env.LANGFUSE_INCLUDE_TEXT === "true" && process.env.APP_ENV !== "production";

export function propagate<T>(t: TraceInput, fn: () => Promise<T>): Promise<T> {
  return propagateAttributes(
    {
      userId: t.userId,
      ...(t.sessionId ? { sessionId: t.sessionId } : {}),
      tags: [`prompt:${t.promptVersion}`, `env:${process.env.APP_ENV ?? "development"}`],
      metadata: { client_version: t.clientVersion ?? "unknown", request_id: t.requestId ?? "" },
    },
    fn,
  );
}

/** Phase spans from the answer pipeline, nested under the active turn. */
type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
};

export const langfuseTracer: Tracer = {
  span(name: string, attributes?: Record<string, unknown>): TraceSpan {
    const metadata = attributes ?? {};
    if (name === "model_call") {
      const generation = startObservation(
        name,
        { model: String(metadata.model ?? ""), metadata },
        { asType: "generation" },
      );
      return {
        end(endAttributes?: Record<string, unknown>) {
          const usage = endAttributes?.usage as Usage | undefined;
          generation.update({
            metadata: { ...metadata, ...(endAttributes ?? {}) },
            ...(endAttributes?.model ? { model: String(endAttributes.model) } : {}),
            ...(usage
              ? {
                  usageDetails: {
                    input: usage.input_tokens,
                    output: usage.output_tokens,
                    cache_read_input_tokens: usage.cache_read_input_tokens,
                    cache_creation_input_tokens: usage.cache_creation_input_tokens,
                  },
                }
              : {}),
          });
          generation.end();
        },
      };
    }
    const span = startObservation(name, { metadata });
    return {
      end(endAttributes?: Record<string, unknown>) {
        span.update({ metadata: { ...metadata, ...(endAttributes ?? {}) } });
        span.end();
      },
    };
  },
};

/**
 * One trace per turn. Records the shape of the question and answer, the validation outcome and the
 * citations (manual page and section references, not policy text), plus the ids needed to find the
 * full text in the database.
 */
export async function traceTurn(
  question: string,
  t: TraceInput,
  run: () => Promise<{ done: DoneData | null; text: string }>,
): Promise<{ done: DoneData | null; text: string }> {
  return startActiveObservation("chat.turn", async (span) => {
    const words = question.trim().split(/\s+/).filter(Boolean).length;
    // Counts go in metadata because that is what the observations API returns for a span; the text
    // itself is attached only when debugging is explicitly enabled outside production.
    span.update({
      metadata: { question_chars: question.length, question_words: words },
      ...(includeText() ? { input: { question } } : {}),
    });
    const started = Date.now();
    const result = await run();
    const d = result.done;
    if (d) {
      span.update({
        ...(includeText() ? { output: { kind: d.kind, text: result.text.slice(0, 4000) } } : {}),
        metadata: {
          question_chars: question.length,
          question_words: words,
          answer_chars: result.text.length,
          citation_count: d.citations.length,
          kind: d.kind,
          validation_passed: d.validation.passed,
          // Codes only: a full problem string can quote the manual or the model's own wording.
          validation_problems: d.validation.problems.map((p) => p.split(":")[0]),
          quotes_verified: d.validation.quotes_verified,
          citations: d.citations.map((c) => ({
            page: c.page,
            program: c.program?.number ?? null,
            section: c.section?.number ?? null,
          })),
          manual_version: d.manual.version_id,
          prompt_version: t.promptVersion,
          stop_reason: d.stop_reason,
          truncated: d.truncated,
          ttft_ms: d.timing.ttft_ms,
          total_ms: d.timing.total_ms,
          conversation_id: d.conversation_id,
          message_id: d.message_id,
        },
      });
    } else {
      span.update({
        metadata: {
          kind: "error",
          question_chars: question.length,
          total_ms: Date.now() - started,
        },
        level: "ERROR",
      });
    }
    return result;
  });
}
