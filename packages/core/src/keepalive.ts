import type Anthropic from "@anthropic-ai/sdk";
import type postgres from "postgres";
import type { CoreConfig } from "./config.ts";
import { loadActiveManual } from "./manual.ts";
import { buildRequestPrefix } from "./prompt/request-prefix.ts";

export type KeepAliveResult = {
  skipped: boolean;
  reason?: string;
  stop_reason?: string | null;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  input_tokens?: number;
  latency_ms?: number;
  error?: string;
};

/**
 * Non-streaming max_tokens: 0 request with the identical cached prefix. Refreshes (or writes) the
 * 1-hour cache entry without generating output. Skipped when a real turn ran recently.
 */
export async function keepAlive(
  deps: { anthropic: Anthropic; sql: postgres.Sql; config: CoreConfig },
  opts: { skipIfTurnWithinMinutes?: number } = {},
): Promise<KeepAliveResult> {
  const within = opts.skipIfTurnWithinMinutes ?? 40;
  const [recent] = await deps.sql<{ n: number }[]>`
    select count(*)::int as n from messages where role = 'assistant' and model is not null and created_at > now() - make_interval(mins => ${within})`;
  let result: KeepAliveResult;
  if ((recent?.n ?? 0) > 0) {
    result = { skipped: true, reason: `real turn within ${within} minutes` };
  } else {
    const started = Date.now();
    try {
      const manual = await loadActiveManual(deps.sql);
      const prefix = buildRequestPrefix(manual);
      type CreateParams = Parameters<typeof deps.anthropic.beta.messages.create>[0];
      const params = {
        model: deps.config.model,
        max_tokens: 0,
        thinking: { type: "adaptive" },
        output_config: { effort: deps.config.effort },
        system: prefix.system,
        messages: [
          { role: "user", content: [prefix.manualDocument, { type: "text", text: "warmup" }] },
        ],
        ...(deps.config.enableRefusalFallbacks
          ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }
          : {}),
      } as unknown as CreateParams;
      const response = (await deps.anthropic.beta.messages.create(params)) as {
        stop_reason: string | null;
        usage: {
          input_tokens: number;
          cache_read_input_tokens: number | null;
          cache_creation_input_tokens: number | null;
        };
      };
      result = {
        skipped: false,
        stop_reason: response.stop_reason,
        cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
        input_tokens: response.usage.input_tokens,
        latency_ms: Date.now() - started,
      };
    } catch (error) {
      result = {
        skipped: false,
        error: error instanceof Error ? error.message : String(error),
        latency_ms: Date.now() - started,
      };
    }
  }
  await deps.sql`
    insert into keepalive_runs (skipped, reason, stop_reason, cache_read_input_tokens, cache_creation_input_tokens, input_tokens, latency_ms, error)
    values (${result.skipped}, ${result.reason ?? null}, ${result.stop_reason ?? null}, ${result.cache_read_input_tokens ?? null},
      ${result.cache_creation_input_tokens ?? null}, ${result.input_tokens ?? null}, ${result.latency_ms ?? null}, ${result.error ?? null})`;
  return result;
}
