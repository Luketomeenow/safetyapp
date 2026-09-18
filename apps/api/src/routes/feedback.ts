import { FeedbackRequestSchema } from "@axxiom/shared";
import { Hono } from "hono";
import { getSql } from "../deps.ts";
import { type AuthedUser, requireUser } from "../middleware/auth.ts";

export const feedback = new Hono<{ Variables: { user: AuthedUser } }>();

feedback.post("/", requireUser, async (c) => {
  const parsed = FeedbackRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return c.json(
      { code: "internal", message: "Invalid request body", issues: parsed.error.issues },
      400,
    );
  const user = c.get("user");
  const sql = getSql();
  const [owned] = await sql<{ id: string }[]>`
    select m.id from messages m join conversations cv on cv.id = m.conversation_id
    where m.id = ${parsed.data.message_id} and cv.user_id = ${user.id} and m.role = 'assistant'`;
  if (!owned) return c.json({ code: "internal", message: "Message not found" }, 404);
  const [row] = await sql<{ id: string }[]>`
    insert into feedback (message_id, user_id, rating, flag, comment)
    values (${parsed.data.message_id}, ${user.id}, ${parsed.data.rating ?? null}, ${parsed.data.flag ?? null}, ${parsed.data.comment ?? null})
    returning id`;
  return c.json({ id: row?.id }, 201);
});
