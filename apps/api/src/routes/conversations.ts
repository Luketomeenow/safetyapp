import { Hono } from "hono";
import { getSql } from "../deps.ts";
import { type AuthedUser, requireUser } from "../middleware/auth.ts";

export const conversations = new Hono<{ Variables: { user: AuthedUser } }>();

conversations.get("/", requireUser, async (c) => {
  const user = c.get("user");
  const limit = Math.min(Number(c.req.query("limit") ?? 20), 50);
  const cursor = c.req.query("cursor");
  const sql = getSql();
  const rows = await sql<
    {
      id: string;
      title: string | null;
      turn_count: number;
      status: string;
      manual_version_id: string;
      created_at: Date;
      last_message_at: Date;
    }[]
  >`
    select id, title, turn_count, status, manual_version_id, created_at, last_message_at from conversations
    where user_id = ${user.id} ${cursor ? sql`and last_message_at < ${new Date(cursor)}` : sql``}
    order by last_message_at desc limit ${limit + 1}`;
  const items = rows.slice(0, limit);
  const next =
    rows.length > limit ? (items[items.length - 1]?.last_message_at.toISOString() ?? null) : null;
  return c.json({ items, next_cursor: next });
});

conversations.get("/:id", requireUser, async (c) => {
  const user = c.get("user");
  const sql = getSql();
  const [conversation] = await sql<
    {
      id: string;
      title: string | null;
      turn_count: number;
      status: string;
      manual_version_id: string;
      created_at: Date;
      last_message_at: Date;
    }[]
  >`
    select id, title, turn_count, status, manual_version_id, created_at, last_message_at from conversations where id = ${c.req.param("id")} and user_id = ${user.id}`;
  if (!conversation) return c.json({ code: "internal", message: "Conversation not found" }, 404);
  const messages = await sql<
    {
      id: string;
      role: string;
      display_text: string;
      response_kind: string | null;
      created_at: Date;
      citations: unknown;
    }[]
  >`
    select m.id, m.role, m.display_text, m.response_kind, m.created_at,
      coalesce(json_agg(json_build_object('page', mc.page_index, 'section_number', mc.section_number, 'program_number', mc.program_number, 'quote', mc.quote) order by mc.ordinal)
        filter (where mc.id is not null), '[]'::json) as citations
    from messages m left join message_citations mc on mc.message_id = m.id
    where m.conversation_id = ${conversation.id}
    group by m.id order by m.turn_index`;
  return c.json({ conversation, messages });
});
