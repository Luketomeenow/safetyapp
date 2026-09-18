import type { ResponseKind } from "@axxiom/shared";
import type postgres from "postgres";

export type ConversationRow = {
  id: string;
  user_id: string;
  manual_version_id: string;
  turn_count: number;
  status: "open" | "closed";
  last_message_at: Date;
};

export class ConversationClosedError extends Error {
  constructor(public readonly reason: string) {
    super(`conversation closed: ${reason}`);
  }
}

export async function getOrCreateConversation(
  sql: postgres.Sql,
  args: {
    userId: string;
    conversationId?: string;
    manualVersionId: string;
    maxTurns: number;
    idleMinutes: number;
  },
): Promise<ConversationRow> {
  if (args.conversationId) {
    const [row] = await sql<ConversationRow[]>`
      select id, user_id, manual_version_id, turn_count, status, last_message_at
      from conversations where id = ${args.conversationId} and user_id = ${args.userId}`;
    if (!row) throw new ConversationClosedError("not_found");
    if (row.status === "closed") throw new ConversationClosedError("closed");
    const idle = Date.now() - new Date(row.last_message_at).getTime() > args.idleMinutes * 60_000;
    const reason =
      row.manual_version_id !== args.manualVersionId
        ? "manual_updated"
        : row.turn_count >= args.maxTurns
          ? "turn_limit"
          : idle
            ? "idle"
            : null;
    if (reason) {
      await sql`update conversations set status = 'closed', closed_reason = ${reason} where id = ${row.id}`;
      throw new ConversationClosedError(reason);
    }
    return row;
  }
  const [created] = await sql<ConversationRow[]>`
    insert into conversations (user_id, manual_version_id)
    values (${args.userId}, ${args.manualVersionId})
    returning id, user_id, manual_version_id, turn_count, status, last_message_at`;
  if (!created) throw new Error("conversation insert returned no row");
  return created;
}

export type HistoryMessage = {
  role: "user" | "assistant";
  content: unknown[];
  display_text: string;
};

export async function loadHistory(
  sql: postgres.Sql,
  conversationId: string,
): Promise<HistoryMessage[]> {
  return sql<HistoryMessage[]>`
    select role, content, display_text from messages
    where conversation_id = ${conversationId} and response_kind is distinct from 'error'
    order by turn_index`;
}

export async function findByClientMessageId(
  sql: postgres.Sql,
  conversationId: string,
  clientMessageId: string,
): Promise<{ id: string } | null> {
  const [row] = await sql<{ id: string }[]>`
    select id from messages where conversation_id = ${conversationId} and client_message_id = ${clientMessageId} and role = 'assistant'`;
  return row ?? null;
}

export type CitationRow = {
  ordinal: number;
  text_block_index: number;
  page_index: number;
  start_block_index: number;
  end_block_index: number;
  section_id: string | null;
  program_number: number | null;
  section_number: string | null;
  cited_text_sha256: string;
  quote: string | null;
  quote_verified: boolean | null;
};

export type TurnRecord = {
  conversationId: string;
  manualVersionId: string;
  userText: string;
  clientMessageId: string | null;
  deviceId: string | null;
  clientVersion: string | null;
  assistant: {
    displayText: string;
    content: unknown[];
    kind: ResponseKind;
    emergencyTrigger: "keyword" | "model" | null;
    model: string | null;
    promptVersion: string;
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens: number;
      cache_creation_input_tokens: number;
    } | null;
    latencyMs: number;
    ttfbMs: number | null;
    stopReason: string | null;
    stopDetails: unknown;
    fallbackRan: boolean | null;
    validation: unknown;
    anthropicMessageId: string | null;
    anthropicRequestId: string | null;
    citations: CitationRow[];
  };
};

/** Writes the user turn, the assistant turn and its citations in one transaction. */
export async function saveTurn(
  sql: postgres.Sql,
  t: TurnRecord,
): Promise<{ messageId: string; turnIndex: number }> {
  return sql.begin(async (tx) => {
    const [conv] = await tx<
      { turn_count: number }[]
    >`select turn_count from conversations where id = ${t.conversationId} for update`;
    const base = (conv?.turn_count ?? 0) * 2;
    await tx`
      insert into messages (conversation_id, turn_index, role, display_text, content, client_message_id, device_id, client_version)
      values (${t.conversationId}, ${base}, 'user', ${t.userText}, ${tx.json([{ type: "text", text: t.userText }])}, ${null}, ${t.deviceId}, ${t.clientVersion})`;
    const a = t.assistant;
    const [assistant] = await tx<{ id: string }[]>`
      insert into messages (conversation_id, turn_index, role, display_text, content, response_kind, emergency_trigger, model, prompt_version,
        manual_version_id, input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, latency_ms, ttfb_ms,
        stop_reason, stop_details, fallback_ran, validation, anthropic_message_id, anthropic_request_id, client_message_id, device_id, client_version)
      values (${t.conversationId}, ${base + 1}, 'assistant', ${a.displayText}, ${tx.json(a.content as never)}, ${a.kind}, ${a.emergencyTrigger}, ${a.model}, ${a.promptVersion},
        ${t.manualVersionId}, ${a.usage?.input_tokens ?? null}, ${a.usage?.output_tokens ?? null}, ${a.usage?.cache_read_input_tokens ?? null}, ${a.usage?.cache_creation_input_tokens ?? null},
        ${a.latencyMs}, ${a.ttfbMs}, ${a.stopReason}, ${tx.json((a.stopDetails ?? null) as never)}, ${a.fallbackRan}, ${tx.json((a.validation ?? null) as never)},
        ${a.anthropicMessageId}, ${a.anthropicRequestId}, ${t.clientMessageId}, ${t.deviceId}, ${t.clientVersion})
      returning id`;
    if (!assistant) throw new Error("assistant message insert returned no row");
    if (a.citations.length > 0) {
      const rows = a.citations.map((c) => ({
        ...c,
        message_id: assistant.id,
        manual_version_id: t.manualVersionId,
      }));
      await tx`insert into message_citations ${tx(rows)}`;
    }
    if (a.kind === "validation_failed") {
      await tx`insert into feedback (message_id, source, flag, comment) values (${assistant.id}, 'auto_flag', 'wrong', 'automatic: validation failed')`;
    }
    await tx`
      update conversations set turn_count = turn_count + 1, last_message_at = now(),
        title = coalesce(title, left(${t.userText}, 80))
      where id = ${t.conversationId}`;
    return { messageId: assistant.id, turnIndex: base + 1 };
  });
}
