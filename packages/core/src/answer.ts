import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { ChatEvent, DoneCitation, ResponseKind } from "@axxiom/shared";
import type postgres from "postgres";
import { type CoreConfig, getConfig } from "./config.ts";
import {
  detectEmergency,
  type EmergencyMatch,
  type Playbooks,
  renderEmergencyText,
} from "./emergency.ts";
import { mapAnthropicError, mentionsBetaHeader } from "./errors.ts";
import { type LoadedManual, loadActiveManual, programForPage, resolveSection } from "./manual.ts";
import {
  type CitationRow,
  ConversationClosedError,
  findByClientMessageId,
  getOrCreateConversation,
  loadHistory,
  saveTurn,
} from "./persist.ts";
import { buildRequestPrefix, pageForBlockIndex } from "./prompt/request-prefix.ts";
import { PROMPT_FINGERPRINT } from "./prompt/system-prompt.ts";
import { fallbackText, parseMarker, validateAnswer } from "./validate.ts";

export type AnswerInput = {
  userId: string;
  message: string;
  conversationId?: string;
  clientMessageId?: string;
  deviceId?: string;
  clientVersion?: string;
  /** false for evals: nothing is written to the database. */
  persist?: boolean;
  signal?: AbortSignal;
};

export type Deps = {
  anthropic: Anthropic;
  sql: postgres.Sql;
  playbooks: Playbooks;
  config: CoreConfig;
  now: () => number;
};

export type AnswerResult = {
  kind: ResponseKind;
  displayText: string;
  /** The model's text after the marker, before any replacement; empty for emergency and error turns. */
  rawText: string;
  citations: DoneCitation[];
  manual: { version_id: string; effective_date: string };
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
  model: string | null;
  promptVersion: string;
  stopReason: string | null;
  stopDetails: unknown;
  fallbackRan: boolean;
  validation: { passed: boolean; problems: string[]; quotes_verified: boolean };
  timing: { ttft_ms: number | null; total_ms: number };
  truncated: boolean;
  conversationId: string;
  messageId: string | null;
};

const EMPTY_USAGE = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};

type RawCitation = {
  textBlockIndex: number;
  startBlock: number;
  endBlock: number;
  citedText: string;
};

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function citationRef(
  manual: LoadedManual,
  page: number,
  id: string,
  quote: string | null,
  sectionNumber?: string | null,
): DoneCitation {
  const program = programForPage(manual, page);
  const section = sectionNumber
    ? (manual.sections.find((s) => s.number === sectionNumber) ?? resolveSection(manual, page))
    : resolveSection(manual, page);
  return {
    id,
    page,
    program: program ? { number: program.number, title: program.title } : null,
    section: section ? { number: section.number, title: section.title } : null,
    quote,
  };
}

/** Builds the messages array: turn 1 always carries the manual so the cached prefix is identical everywhere. */
export function buildMessages(
  prefix: ReturnType<typeof buildRequestPrefix>,
  history: { role: "user" | "assistant"; content: unknown[] }[],
  newMessage: string,
) {
  const turns: { role: "user" | "assistant"; content: unknown[] }[] = [
    ...history,
    { role: "user", content: [{ type: "text", text: newMessage }] },
  ];
  const first = turns[0];
  if (!first || first.role !== "user") throw new Error("history must start with a user turn");
  const firstText = (first.content as { type: string; text?: string }[]).filter(
    (b) => b.type === "text",
  );
  return [
    { role: "user" as const, content: [prefix.manualDocument, ...firstText] },
    ...turns.slice(1).map((t) => ({
      role: t.role,
      content: t.role === "assistant" ? sanitizeForReplay(t.content) : t.content,
    })),
  ];
}

/** After a mid-output fallback, thinking blocks before the last fallback block must not be echoed. */
export function sanitizeForReplay(content: unknown[]): unknown[] {
  const blocks = content as { type: string }[];
  const lastFallback = blocks.map((b) => b.type).lastIndexOf("fallback");
  return blocks.filter((b, i) => {
    if (
      i < lastFallback &&
      (b.type === "thinking" || b.type === "redacted_thinking" || b.type === "tool_use")
    )
      return false;
    return b.type !== "fallback";
  });
}

export function createDeps(
  overrides: Partial<Deps> & { sql: postgres.Sql; playbooks: Playbooks },
): Deps {
  return {
    anthropic: overrides.anthropic ?? new Anthropic({ maxRetries: 2, timeout: 120_000 }),
    config: overrides.config ?? getConfig(),
    now: overrides.now ?? (() => Date.now()),
    sql: overrides.sql,
    playbooks: overrides.playbooks,
  };
}

/**
 * Answers one question as a stream of ChatEvents and returns the AnswerResult. Runs the deterministic
 * emergency check, assembles the cached prefix plus history, streams the model, validates, persists.
 */
export async function* answerQuestion(
  input: AnswerInput,
  deps: Deps,
): AsyncGenerator<ChatEvent, AnswerResult> {
  const started = deps.now();
  const persist = input.persist !== false;
  const manual = await loadActiveManual(deps.sql);
  const manualRef = { version_id: manual.version_id, effective_date: manual.effective_date };

  let conversationId = input.conversationId ?? "";
  let history: { role: "user" | "assistant"; content: unknown[] }[] = [];
  if (persist) {
    try {
      const conversation = await getOrCreateConversation(deps.sql, {
        userId: input.userId,
        conversationId: input.conversationId,
        manualVersionId: manual.version_id,
        maxTurns: deps.config.maxTurnsPerConversation,
        idleMinutes: deps.config.idleCloseMinutes,
      });
      conversationId = conversation.id;
      if (input.clientMessageId) {
        const existing = await findByClientMessageId(
          deps.sql,
          conversationId,
          input.clientMessageId,
        );
        if (existing) throw new DuplicateMessageError(existing.id);
      }
      history = (await loadHistory(deps.sql, conversationId)).map((h) => ({
        role: h.role,
        content: h.content,
      }));
    } catch (error) {
      if (error instanceof ConversationClosedError) {
        yield {
          event: "error",
          data: {
            code: "conversation_closed",
            message: "This conversation is closed. Start a new one.",
            retryable: false,
          },
        };
        return errorResult(manualRef, conversationId, started, deps);
      }
      throw error;
    }
  }

  yield { event: "status", data: { stage: "reading_manual" } };

  const emergency = detectEmergency(input.message, deps.playbooks);
  if (emergency)
    return yield* emergencyTurn(
      input,
      deps,
      manual,
      manualRef,
      conversationId,
      emergency,
      started,
      persist,
    );

  const prefix = buildRequestPrefix(manual);
  const messages = buildMessages(prefix, history, input.message);
  const baseParams = {
    model: deps.config.model,
    max_tokens: deps.config.maxTokens,
    thinking: { type: "adaptive" as const },
    output_config: { effort: deps.config.effort },
    system: prefix.system,
    messages,
  };
  const withFallbacks = deps.config.enableRefusalFallbacks
    ? { ...baseParams, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" }
    : baseParams;

  type StreamParams = Parameters<typeof deps.anthropic.beta.messages.stream>[0];
  const open = (params: unknown) =>
    deps.anthropic.beta.messages.stream(params as StreamParams, { signal: input.signal });

  // Start the request before consuming it, so an immediate failure (rejected beta header, auth,
  // billing, rate limit) surfaces as an error event instead of a stream that never yields.
  let stream = open(withFallbacks);
  let openError: unknown = null;
  try {
    await stream.withResponse();
  } catch (error) {
    openError = error;
  }
  if (openError !== null && deps.config.enableRefusalFallbacks && mentionsBetaHeader(openError)) {
    stream = open(baseParams);
    try {
      await stream.withResponse();
      openError = null;
    } catch (error) {
      openError = error;
    }
  }
  if (openError !== null) {
    const mapped = mapAnthropicError(openError);
    console.error("chat request failed to start", { code: mapped.code, alert: mapped.alert });
    yield {
      event: "error",
      data: { code: mapped.code, message: mapped.message, retryable: mapped.retryable },
    };
    return errorResult(manualRef, conversationId, started, deps);
  }

  const textParts = new Map<number, string>();
  const rawCitations: RawCitation[] = [];
  let ttft: number | null = null;
  let gateOpen = false;
  let held = "";
  let kind: ResponseKind | null = null;
  const emittedPages = new Set<number>();
  let stopReason: string | null = null;

  try {
    for await (const event of stream) {
      if (event.type === "message_start") {
        yield { event: "status", data: { stage: "writing" } };
      } else if (event.type === "content_block_delta") {
        const delta = event.delta as {
          type: string;
          text?: string;
          citation?: Record<string, unknown>;
        };
        if (delta.type === "text_delta" && typeof delta.text === "string") {
          if (ttft === null) ttft = deps.now() - started;
          textParts.set(event.index, (textParts.get(event.index) ?? "") + delta.text);
          if (!gateOpen) {
            held += delta.text;
            if (held.includes("\n")) {
              const parsed = parseMarker(held);
              kind = parsed.kind;
              gateOpen = true;
              if (parsed.body.length > 0) yield { event: "text", data: { delta: parsed.body } };
              held = "";
            }
          } else {
            yield { event: "text", data: { delta: delta.text } };
          }
        } else if (
          delta.type === "citations_delta" &&
          delta.citation &&
          delta.citation.type === "content_block_location"
        ) {
          const c = delta.citation as {
            start_block_index: number;
            end_block_index: number;
            cited_text: string;
          };
          rawCitations.push({
            textBlockIndex: event.index,
            startBlock: c.start_block_index,
            endBlock: c.end_block_index,
            citedText: c.cited_text,
          });
          for (let b = c.start_block_index; b < c.end_block_index; b += 1) {
            const page = pageForBlockIndex(b);
            if (emittedPages.has(page)) continue;
            emittedPages.add(page);
            yield {
              event: "citation",
              data: {
                ...citationRef(manual, page, `c${emittedPages.size}`, null),
                quote: undefined,
              } as never,
            };
          }
        }
      } else if (event.type === "message_delta") {
        stopReason = (event.delta as { stop_reason?: string | null }).stop_reason ?? stopReason;
      }
    }
  } catch (error) {
    const mapped = mapAnthropicError(error);
    if (mentionsBetaHeader(error) && deps.config.enableRefusalFallbacks) {
      mapped.message = `${mapped.message} (fallback beta rejected; disable ENABLE_REFUSAL_FALLBACKS)`;
    }
    yield {
      event: "error",
      data: { code: mapped.code, message: mapped.message, retryable: mapped.retryable },
    };
    return errorResult(manualRef, conversationId, started, deps);
  }

  const final = await stream.finalMessage();
  if (!gateOpen) {
    const parsed = parseMarker(held);
    kind = parsed.kind;
    gateOpen = true;
    if (parsed.body.length > 0) yield { event: "text", data: { delta: parsed.body } };
  }
  stopReason = final.stop_reason ?? stopReason;
  const fullText = final.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("");
  const { body } = parseMarker(fullText);
  const usage = {
    input_tokens: final.usage.input_tokens ?? 0,
    output_tokens: final.usage.output_tokens ?? 0,
    cache_read_input_tokens: final.usage.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: final.usage.cache_creation_input_tokens ?? 0,
  };
  const iterations = (final.usage as { iterations?: { type: string }[] }).iterations ?? [];
  const fallbackRan = iterations.some((i) => i.type === "fallback_message");

  yield { event: "status", data: { stage: "verifying" } };
  const citedPages = [
    ...new Set(
      rawCitations.flatMap((c) =>
        Array.from({ length: c.endBlock - c.startBlock }, (_, i) =>
          pageForBlockIndex(c.startBlock + i),
        ),
      ),
    ),
  ];
  const citedTexts = new Map<number, string>();
  for (const c of rawCitations)
    if (c.endBlock - c.startBlock === 1)
      citedTexts.set(pageForBlockIndex(c.startBlock), c.citedText);

  let finalKind: ResponseKind = kind ?? "validation_failed";
  let displayText = body;
  const validation = validateAnswer(manual, { kind, body, citedPages, citedTexts, stopReason });
  if (stopReason === "refusal") {
    finalKind = "refusal";
    displayText = fallbackText("refusal", validation.validPages, manual);
    yield { event: "replace", data: { text: displayText, reason: "refusal" } };
  } else if (!validation.passed) {
    finalKind = "validation_failed";
    displayText = fallbackText(kind, validation.validPages, manual);
    yield {
      event: "replace",
      data: { text: displayText, reason: validation.truncated ? "truncated" : "validation_failed" },
    };
  }

  const quoteByPage = new Map<number, { quote: string; sectionNumber: string | null }>();
  for (const check of validation.checks)
    if (check.found && check.page)
      quoteByPage.set(check.page, { quote: check.quote.text, sectionNumber: check.sectionNumber });
  const doneCitations: DoneCitation[] = validation.validPages.map((page, i) => {
    const q = quoteByPage.get(page);
    return citationRef(manual, page, `c${i + 1}`, q?.quote ?? null, q?.sectionNumber);
  });
  const citationRows: CitationRow[] = rawCitations
    .flatMap((c, ordinal) =>
      Array.from({ length: c.endBlock - c.startBlock }, (_, i) => {
        const page = pageForBlockIndex(c.startBlock + i);
        const q = quoteByPage.get(page);
        const section = q?.sectionNumber
          ? manual.sections.find((s) => s.number === q.sectionNumber)
          : resolveSection(manual, page);
        return {
          ordinal,
          text_block_index: c.textBlockIndex,
          page_index: page,
          start_block_index: c.startBlock,
          end_block_index: c.endBlock,
          section_id: section?.id ?? null,
          program_number: programForPage(manual, page)?.number ?? null,
          section_number: section?.number ?? null,
          cited_text_sha256: sha256(c.citedText),
          quote: q?.quote ?? null,
          quote_verified: q ? true : null,
        };
      }),
    )
    .filter(
      (row) => row.page_index >= manual.body_start_page && row.page_index <= manual.page_count,
    );
  // Pages grounded only by a verified quote (no API citation block) get a synthetic row.
  for (const [page, q] of quoteByPage) {
    if (citationRows.some((r) => r.page_index === page)) continue;
    const section = q.sectionNumber
      ? manual.sections.find((s) => s.number === q.sectionNumber)
      : resolveSection(manual, page);
    citationRows.push({
      ordinal: citationRows.length,
      text_block_index: -1,
      page_index: page,
      start_block_index: page - 1,
      end_block_index: page,
      section_id: section?.id ?? null,
      program_number: programForPage(manual, page)?.number ?? null,
      section_number: section?.number ?? null,
      cited_text_sha256: sha256(manual.pages[page - 1]?.block_text ?? ""),
      quote: q.quote,
      quote_verified: true,
    });
  }

  const total = deps.now() - started;
  let messageId: string | null = null;
  if (persist) {
    const saved = await saveTurn(deps.sql, {
      conversationId,
      manualVersionId: manual.version_id,
      userText: input.message,
      clientMessageId: input.clientMessageId ?? null,
      deviceId: input.deviceId ?? null,
      clientVersion: input.clientVersion ?? null,
      assistant: {
        displayText,
        content: final.content as unknown[],
        kind: finalKind,
        emergencyTrigger: finalKind === "emergency" ? "model" : null,
        model: final.model,
        promptVersion: PROMPT_FINGERPRINT,
        usage,
        latencyMs: total,
        ttfbMs: ttft,
        stopReason,
        stopDetails: (final as { stop_details?: unknown }).stop_details ?? null,
        fallbackRan,
        validation: {
          passed: validation.passed,
          problems: validation.problems,
          quotes_verified: validation.quotesVerified,
        },
        anthropicMessageId: final.id,
        anthropicRequestId: (final as { _request_id?: string | null })._request_id ?? null,
        citations: citationRows,
      },
    });
    messageId = saved.messageId;
  }

  const result: AnswerResult = {
    kind: finalKind,
    displayText,
    rawText: body,
    citations: doneCitations,
    manual: manualRef,
    usage,
    model: final.model,
    promptVersion: PROMPT_FINGERPRINT,
    stopReason,
    stopDetails: (final as { stop_details?: unknown }).stop_details ?? null,
    fallbackRan,
    validation: {
      passed: validation.passed,
      problems: validation.problems,
      quotes_verified: validation.quotesVerified,
    },
    timing: { ttft_ms: ttft, total_ms: total },
    truncated: validation.truncated,
    conversationId,
    messageId,
  };
  yield doneEvent(result, input.clientMessageId ?? null);
  return result;
}

async function* emergencyTurn(
  input: AnswerInput,
  deps: Deps,
  manual: LoadedManual,
  manualRef: { version_id: string; effective_date: string },
  conversationId: string,
  match: EmergencyMatch,
  started: number,
  persist: boolean,
): AsyncGenerator<ChatEvent, AnswerResult> {
  const text = renderEmergencyText(match, deps.playbooks);
  const citations = match.steps
    .filter((s) => s.page)
    .map((s) => ({ page: s.page as number, section: s.section ?? "" }));
  yield {
    event: "emergency",
    data: {
      headline: match.headline,
      steps: match.steps.map((s) => s.text),
      call: deps.playbooks.call,
      contacts: deps.playbooks.contacts.map((c) => ({ label: c.label, tel: c.tel })),
      citations,
    },
  };
  const doneCitations: DoneCitation[] = [...new Set(citations.map((c) => c.page))].map(
    (page, i) => {
      const step = match.steps.find((s) => s.page === page);
      return citationRef(manual, page, `c${i + 1}`, step?.quote ?? null, step?.section ?? null);
    },
  );
  const total = deps.now() - started;
  let messageId: string | null = null;
  if (persist) {
    const saved = await saveTurn(deps.sql, {
      conversationId,
      manualVersionId: manual.version_id,
      userText: input.message,
      clientMessageId: input.clientMessageId ?? null,
      deviceId: input.deviceId ?? null,
      clientVersion: input.clientVersion ?? null,
      assistant: {
        displayText: text,
        content: [{ type: "text", text }],
        kind: "emergency",
        emergencyTrigger: "keyword",
        model: null,
        promptVersion: PROMPT_FINGERPRINT,
        usage: null,
        latencyMs: total,
        ttfbMs: null,
        stopReason: null,
        stopDetails: null,
        fallbackRan: null,
        validation: { passed: true, problems: [], quotes_verified: true },
        anthropicMessageId: null,
        anthropicRequestId: null,
        citations: [],
      },
    });
    messageId = saved.messageId;
  }
  const result: AnswerResult = {
    kind: "emergency",
    displayText: text,
    rawText: "",
    citations: doneCitations,
    manual: manualRef,
    usage: EMPTY_USAGE,
    model: null,
    promptVersion: PROMPT_FINGERPRINT,
    stopReason: null,
    stopDetails: null,
    fallbackRan: false,
    validation: { passed: true, problems: [], quotes_verified: true },
    timing: { ttft_ms: null, total_ms: total },
    truncated: false,
    conversationId,
    messageId,
  };
  yield doneEvent(result, input.clientMessageId ?? null);
  return result;
}

function doneEvent(r: AnswerResult, clientMessageId: string | null): ChatEvent {
  return {
    event: "done",
    data: {
      message_id: r.messageId ?? "",
      conversation_id: r.conversationId,
      client_message_id: clientMessageId,
      kind: r.kind,
      stop_reason: r.stopReason,
      truncated: r.truncated,
      validation: r.validation,
      citations: r.citations,
      manual: r.manual,
      usage: r.usage,
      timing: r.timing,
    },
  };
}

function errorResult(
  manualRef: { version_id: string; effective_date: string },
  conversationId: string,
  started: number,
  deps: Deps,
): AnswerResult {
  return {
    kind: "error",
    displayText: "",
    rawText: "",
    citations: [],
    manual: manualRef,
    usage: EMPTY_USAGE,
    model: null,
    promptVersion: PROMPT_FINGERPRINT,
    stopReason: null,
    stopDetails: null,
    fallbackRan: false,
    validation: { passed: false, problems: ["error"], quotes_verified: false },
    timing: { ttft_ms: null, total_ms: deps.now() - started },
    truncated: false,
    conversationId,
    messageId: null,
  };
}

export class DuplicateMessageError extends Error {
  constructor(public readonly messageId: string) {
    super("duplicate client_message_id");
  }
}

/** Drains the generator; used by the eval harness and tests. */
export async function answerOnce(input: AnswerInput, deps: Deps): Promise<AnswerResult> {
  const gen = answerQuestion(input, deps);
  for (;;) {
    const next = await gen.next();
    if (next.done) return next.value;
  }
}
