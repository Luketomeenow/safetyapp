import type { MiddlewareHandler } from "hono";
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";
import { getSql } from "../deps.ts";

export type AuthedUser = { id: string; role: string; issuer: string; subject: string };

let jwks: JWTVerifyGetKey | null = null;

async function verifyToken(token: string): Promise<{ issuer: string; subject: string }> {
  const issuer = process.env.AUTH_ISSUER;
  const audience = process.env.AUTH_AUDIENCE;
  const devToken = process.env.DEV_AUTH_TOKEN;
  if (devToken && token === devToken && process.env.APP_ENV !== "production") {
    return { issuer: "dev", subject: "dev-user" };
  }
  const options = { ...(issuer ? { issuer } : {}), ...(audience ? { audience } : {}) };
  if (process.env.AUTH_JWKS_URL) {
    jwks ??= createRemoteJWKSet(new URL(process.env.AUTH_JWKS_URL));
    const { payload } = await jwtVerify(token, jwks, options);
    return { issuer: String(payload.iss ?? issuer ?? ""), subject: String(payload.sub ?? "") };
  }
  if (process.env.AUTH_HS256_SECRET) {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(process.env.AUTH_HS256_SECRET),
      options,
    );
    return { issuer: String(payload.iss ?? issuer ?? ""), subject: String(payload.sub ?? "") };
  }
  throw new Error("No auth verifier configured (AUTH_JWKS_URL or AUTH_HS256_SECRET)");
}

/** Verifies the bearer token and upserts the pseudonymous user; sets c.var.user. */
export const requireUser: MiddlewareHandler<{ Variables: { user: AuthedUser } }> = async (
  c,
  next,
) => {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return c.json({ code: "unauthorized", message: "Missing bearer token" }, 401);
  let claims: { issuer: string; subject: string };
  try {
    claims = await verifyToken(token);
  } catch {
    return c.json({ code: "unauthorized", message: "Invalid or expired token" }, 401);
  }
  if (!claims.subject)
    return c.json({ code: "unauthorized", message: "Token has no subject" }, 401);
  const sql = getSql();
  const [user] = await sql<{ id: string; role: string; disabled_at: Date | null }[]>`
    insert into app_users (issuer, subject) values (${claims.issuer}, ${claims.subject})
    on conflict (issuer, subject) do update set subject = excluded.subject
    returning id, role, disabled_at`;
  if (!user) return c.json({ code: "internal", message: "user upsert failed" }, 500);
  if (user.disabled_at) return c.json({ code: "unauthorized", message: "Account disabled" }, 403);
  c.set("user", { id: user.id, role: user.role, issuer: claims.issuer, subject: claims.subject });
  await next();
};
