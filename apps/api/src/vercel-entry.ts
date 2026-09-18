import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { app } from "./app.ts";
import { startTelemetry } from "./telemetry.ts";

startTelemetry();

// Routed by .vercel/output/config.json: every path reaches this function. Accept an optional
// /api prefix so both /health and /api/health work.
const entry = new Hono();
entry.all("/api/*", (c) => {
  const url = new URL(c.req.url);
  url.pathname = url.pathname.replace(/^\/api/, "") || "/";
  return app.fetch(new Request(url, c.req.raw));
});
entry.all("*", (c) => app.fetch(c.req.raw));

export default getRequestListener(entry.fetch);
