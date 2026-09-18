import { Hono } from "hono";
import { chat } from "./routes/chat.ts";
import { conversations } from "./routes/conversations.ts";
import { feedback } from "./routes/feedback.ts";
import { manual } from "./routes/manual.ts";
import { system } from "./routes/system.ts";

export const app = new Hono();

app.use("*", async (c, next) => {
  const id = c.req.header("x-request-id") ?? crypto.randomUUID();
  c.header("X-Request-Id", id);
  await next();
});

app.get("/__debug", (c) =>
  c.json({
    url: c.req.url,
    path: c.req.path,
    env: process.env.APP_ENV ?? null,
    region: process.env.VERCEL_REGION ?? null,
  }),
);
app.route("/", system);
app.route("/v1/chat", chat);
app.route("/v1/manual", manual);
app.route("/v1/feedback", feedback);
app.route("/v1/conversations", conversations);

app.notFound((c) => c.json({ code: "internal", message: "Not found" }, 404));
app.onError((error, c) => {
  console.error("unhandled", error);
  return c.json({ code: "internal", message: "Unexpected error" }, 500);
});
