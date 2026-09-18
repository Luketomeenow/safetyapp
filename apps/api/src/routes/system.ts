import { keepAlive } from "@axxiom/core";
import { Hono } from "hono";
import { getDeps, getSql } from "../deps.ts";

export const system = new Hono();

system.get("/health", async (c) => {
  try {
    const sql = getSql();
    const [v] = await sql<
      { id: string; page_count: number }[]
    >`select id, page_count from manual_versions where status = 'active' limit 1`;
    return c.json({
      ok: Boolean(v),
      db: "ok",
      manual: v ? { version_id: v.id, page_count: v.page_count } : null,
    });
  } catch (error) {
    return c.json(
      { ok: false, db: "error", error: error instanceof Error ? error.message : String(error) },
      503,
    );
  }
});

system.get("/health/deep", async (c) => {
  const deps = getDeps();
  try {
    const [v] = await deps.sql<
      { id: string }[]
    >`select id from manual_versions where status = 'active' limit 1`;
    const model = await deps.anthropic.models.retrieve(deps.config.model);
    return c.json({ ok: Boolean(v), manual: v?.id ?? null, model: model.id });
  } catch (error) {
    return c.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      503,
    );
  }
});

system.get("/v1/config", (c) => {
  const deps = getDeps();
  return c.json({
    emergency_contacts: deps.playbooks.contacts.map((x) => ({
      label: x.label,
      tel: x.tel,
      ...(x.note ? { note: x.note } : {}),
    })),
    disclaimer_version: process.env.DISCLAIMER_VERSION ?? "2026-09-01",
    min_app_version: process.env.MIN_APP_VERSION ?? "1.0.0",
  });
});

system.post("/internal/cache-keepalive", async (c) => {
  const secret = process.env.CRON_SECRET;
  const header = c.req.header("authorization") ?? "";
  if (!secret || header !== `Bearer ${secret}`) return c.json({ code: "unauthorized" }, 401);
  const result = await keepAlive(getDeps());
  return c.json(result);
});
// Vercel cron sends GET requests
system.get("/internal/cache-keepalive", async (c) => {
  const secret = process.env.CRON_SECRET;
  const header = c.req.header("authorization") ?? "";
  if (!secret || header !== `Bearer ${secret}`) return c.json({ code: "unauthorized" }, 401);
  const result = await keepAlive(getDeps());
  return c.json(result);
});
