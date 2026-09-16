# Decisions

| Date | Decision | Why |
|---|---|---|
| 2026-09-16 | TypeScript on Node 24, pnpm workspaces, Hono | One language across API, ingestion and evals; official Anthropic TypeScript SDK |
| 2026-09-16 | Supabase (Postgres, Storage, Auth) + Vercel (Pro) | Managed, matches the blueprint; local development points at the staging Supabase project (no Docker) |
| 2026-09-16 | Pluggable OIDC JWT verification; Supabase Auth for dev and pilot | Company identity provider not yet chosen; swap later by changing issuer, audience and JWKS URL |
| 2026-09-16 | Whole manual in context, one document block per PDF page, citations enabled, 1 h prompt cache; no retrieval in v1 | Removes retrieval misses; the manual is ~115K tokens |
| 2026-09-16 | Claude Opus 5 answers; Claude Sonnet 5 judges and drafts eval seeds | Gold data must not come from the model under test |
| 2026-09-16 | Citations use program/subsection numbers plus the PDF page index, never TOC page numbers | The TOC's page numbers drift from 3 to ~20 pages off the PDF |
| 2026-09-16 | TOC pages become one-line placeholder blocks | Keeps the model from echoing wrong page numbers; saves ~10K tokens per request |
| 2026-09-16 | Tables rebuilt from a registry (`tables.json`), written in full on every page they span | Page blocks stay self-contained so citations to either page verify |
| 2026-09-16 | Hand-written SQL migrations applied with the Supabase CLI; `postgres` driver through the transaction pooler | Small schema; fewer moving parts than an ORM |
| 2026-09-16 | Custom TypeScript eval harness (not Promptfoo) | In-process calls share one warm cache; deterministic citation checks; per-category thresholds |
| 2026-09-16 | iOS: SwiftUI, iOS 17+, XcodeGen, one dependency (supabase-swift Auth), no Markdown library, Sentry deferred | Smallest surface for the pre-pilot security review |
