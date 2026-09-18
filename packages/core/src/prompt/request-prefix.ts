import type { LoadedManual } from "../manual.ts";
import { SYSTEM_PROMPT } from "./system-prompt.ts";

export const MANUAL_TITLE =
  "Axxiom Elevator Safety and Health Policies, Section 2: Specific Safety Policies";

/** Deterministic JSON: sorted keys, no whitespace. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * The stable, cacheable prefix shared by the answer call and the keep-alive: frozen system prompt
 * plus the whole manual as one custom-content document (one text block per PDF page, so citations
 * come back as block indices that map to pages) with the single cache breakpoint on the document.
 */
export function buildRequestPrefix(manual: LoadedManual) {
  const manualDocument = {
    type: "document" as const,
    source: {
      type: "content" as const,
      content: manual.pages.map((p) => ({ type: "text" as const, text: p.block_text })),
    },
    title: MANUAL_TITLE,
    context: stableStringify({
      version_id: manual.version_id,
      effective_date: manual.effective_date,
      page_count: manual.page_count,
      body_start_page: manual.body_start_page,
      programs: manual.programs.map(
        (p) => `${p.number} ${p.title} (pages ${p.start_page}-${p.end_page})`,
      ),
    }),
    citations: { enabled: true as const },
    cache_control: { type: "ephemeral" as const, ttl: "1h" as const },
  };
  return {
    system: [{ type: "text" as const, text: SYSTEM_PROMPT }],
    manualDocument,
  };
}

/** Block index i in the document is PDF page i + 1. */
export function pageForBlockIndex(blockIndex: number): number {
  return blockIndex + 1;
}
