import type { ChatEvent } from "@axxiom/shared";
import { propagateAttributes, startActiveObservation } from "@langfuse/tracing";
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

/** One trace per turn: input question, output text, kind, validation, citations, plus a generation with usage. */
export async function traceTurn(
  question: string,
  t: TraceInput,
  run: () => Promise<{ done: DoneData | null; text: string }>,
): Promise<{ done: DoneData | null; text: string }> {
  return startActiveObservation("chat.turn", async (span) => {
    span.update({ input: { question } });
    const started = Date.now();
    const result = await run();
    const d = result.done;
    if (d) {
      span.update({
        output: { kind: d.kind, text: result.text.slice(0, 4000) },
        metadata: {
          kind: d.kind,
          validation_passed: d.validation.passed,
          validation_problems: d.validation.problems,
          quotes_verified: d.validation.quotes_verified,
          citations: d.citations.map((c) => ({ page: c.page, section: c.section?.number ?? null })),
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
      if (d.kind !== "emergency" && d.kind !== "error") {
        const generation = span.startObservation(
          "model.call",
          {
            model: process.env.ANTHROPIC_MODEL ?? "claude-opus-5",
            input: { question },
            output: result.text.slice(0, 4000),
            usageDetails: {
              input: d.usage.input_tokens,
              output: d.usage.output_tokens,
              cache_read_input_tokens: d.usage.cache_read_input_tokens,
              cache_creation_input_tokens: d.usage.cache_creation_input_tokens,
            },
            metadata: {
              stop_reason: d.stop_reason,
              ttft_ms: d.timing.ttft_ms,
              effort: process.env.ANTHROPIC_EFFORT ?? "medium",
            },
          },
          { asType: "generation" },
        );
        generation.end();
      }
    } else {
      span.update({
        output: { kind: "error" },
        metadata: { total_ms: Date.now() - started },
        level: "ERROR",
      });
    }
    return result;
  });
}
