import type { Usage } from "./schema.ts";

/** List prices per million tokens (input, output, cache read, 1-hour cache write). */
export const PRICES: Record<
  string,
  { input: number; output: number; cache_read: number; cache_write_1h: number }
> = {
  "claude-opus-5": { input: 5, output: 25, cache_read: 0.5, cache_write_1h: 10 },
  "claude-sonnet-5": { input: 2, output: 10, cache_read: 0.2, cache_write_1h: 4 },
  "claude-haiku-4-5": { input: 1, output: 5, cache_read: 0.1, cache_write_1h: 2 },
};

export function costUsd(model: string | null, usage: Usage | null): number {
  if (!model || !usage) return 0;
  const key = Object.keys(PRICES).find((k) => model.startsWith(k));
  const p = key ? PRICES[key] : undefined;
  if (!p) return 0;
  return (
    (usage.input_tokens * p.input +
      usage.output_tokens * p.output +
      usage.cache_read_input_tokens * p.cache_read +
      usage.cache_creation_input_tokens * p.cache_write_1h) /
    1_000_000
  );
}
