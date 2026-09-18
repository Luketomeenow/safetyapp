import type { MiddlewareHandler } from "hono";
import { getSql } from "../deps.ts";
import type { AuthedUser } from "./auth.ts";

/** Per-user hourly and daily buckets via the consume_rate_limit SQL function. */
export const rateLimit: MiddlewareHandler<{ Variables: { user: AuthedUser } }> = async (
  c,
  next,
) => {
  const user = c.get("user");
  const perHour = Number(process.env.RATE_LIMIT_PER_HOUR ?? 30);
  const perDay = Number(process.env.RATE_LIMIT_PER_DAY ?? 120);
  const sql = getSql();
  const now = new Date();
  const hour = new Date(now);
  hour.setUTCMinutes(0, 0, 0);
  const day = new Date(now);
  day.setUTCHours(0, 0, 0, 0);
  const [h] = await sql<
    { ok: boolean }[]
  >`select consume_rate_limit(${user.id}, 'hour', ${hour}, ${perHour}) as ok`;
  const [d] = await sql<
    { ok: boolean }[]
  >`select consume_rate_limit(${user.id}, 'day', ${day}, ${perDay}) as ok`;
  if (!h?.ok || !d?.ok) {
    const retry = h?.ok
      ? 3600
      : Math.max(60, Math.ceil((hour.getTime() + 3_600_000 - now.getTime()) / 1000));
    c.header("Retry-After", String(retry));
    return c.json(
      {
        code: "rate_limited",
        message: "Too many questions right now. Try again in a minute.",
        retryable: true,
      },
      429,
    );
  }
  await next();
};
