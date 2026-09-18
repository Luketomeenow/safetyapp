import { answerQuestion, DuplicateMessageError, ManualUnavailableError } from "@axxiom/core";
import { type ChatEvent, ChatRequestSchema } from "@axxiom/shared";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getDeps, getSql } from "../deps.ts";
import { type AuthedUser, requireUser } from "../middleware/auth.ts";
import { rateLimit } from "../middleware/rate-limit.ts";

export const chat = new Hono<{ Variables: { user: AuthedUser } }>();

chat.post("/", requireUser, rateLimit, async (c) => {
  if ((process.env.CHAT_DISABLED ?? "false") === "true") {
    return c.json(
      {
        code: "upstream_unavailable",
        message: "The assistant is paused. Use the manual in the app.",
        retryable: true,
      },
      503,
    );
  }
  const parsed = ChatRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success)
    return c.json(
      { code: "internal", message: "Invalid request body", issues: parsed.error.issues },
      400,
    );
  const body = parsed.data;
  const user = c.get("user");
  const deps = getDeps();

  c.header("Cache-Control", "no-cache, no-transform");
  c.header("X-Accel-Buffering", "no");
  return streamSSE(c, async (stream) => {
    const send = (ev: ChatEvent) =>
      stream.writeSSE({ event: ev.event, data: JSON.stringify(ev.data) });
    const ping = setInterval(() => {
      stream.write(": ping\n\n").catch(() => clearInterval(ping));
    }, 10_000);
    const abort = new AbortController();
    stream.onAbort(() => abort.abort());
    try {
      const gen = answerQuestion(
        {
          userId: user.id,
          message: body.message,
          conversationId: body.conversation_id,
          clientMessageId: body.client_message_id,
          deviceId: body.device_id,
          clientVersion: body.client_version,
          signal: abort.signal,
        },
        deps,
      );
      for await (const ev of gen) await send(ev);
    } catch (error) {
      if (error instanceof DuplicateMessageError) {
        const sql = getSql();
        const [row] = await sql<
          { display_text: string; conversation_id: string; response_kind: string }[]
        >`
          select display_text, conversation_id, response_kind from messages where id = ${error.messageId}`;
        if (row)
          await send({
            event: "replace",
            data: { text: row.display_text, reason: "validation_failed" },
          });
        await send({
          event: "error",
          data: {
            code: "internal",
            message: "This message was already answered.",
            retryable: false,
          },
        });
      } else if (error instanceof ManualUnavailableError) {
        await send({
          event: "error",
          data: {
            code: "manual_unavailable",
            message: "The manual is not available right now.",
            retryable: true,
          },
        });
      } else {
        console.error("chat error", error);
        await send({
          event: "error",
          data: {
            code: "internal",
            message: "The assistant hit an unexpected error. Use the manual in the app.",
            retryable: true,
          },
        });
      }
    } finally {
      clearInterval(ping);
    }
  });
});
