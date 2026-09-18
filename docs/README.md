# Axxiom Safety Assistant

Internal iPhone assistant that answers Axxiom Elevator technicians' safety questions strictly from the company's Safety and Health Policies manual, with page citations they can open in the manual.

Design: `Axxiom-Safety-Assistant-Blueprint.html` at the repo root. Decisions: `docs/decisions.md`.

## Layout

| Path | Purpose |
|---|---|
| `packages/shared` | zod schemas and text normalization shared by every package (manifest, SSE events, REST payloads) |
| `packages/ingest` | turns the manual PDF into versioned per-page blocks with program/subsection mapping |
| `packages/core` | answer pipeline: prompt, Claude call with citations, validation, persistence (Phase 1) |
| `apps/api` | Hono API deployed on Vercel (Phase 1) |
| `packages/evals` | eval harness, test sets, seed drafting (Phase 1) |
| `supabase/` | SQL migrations (Phase 1) |
| `corpus/<slug>/<version>/` | source PDF, table registry, overrides, generated manifest and review material |
| `ios/` | SwiftUI app (Phase 2) |

## Setup

```sh
brew install poppler          # pdftotext / pdfinfo
corepack enable && pnpm install
cp .env.example .env          # fill in keys as phases need them
```

## Commands

```sh
pnpm typecheck
pnpm test
pnpm lint
pnpm ingest -- run --pdf corpus/axxiom-s2/v1.0/source.pdf --version-id axxiom-s2-v1.0 --expect-pages 209
pnpm ingest -- inspect --version-id axxiom-s2-v1.0 --page 56
```

Ingestion writes intermediate artifacts to `.ingest/<version-id>/` (ignored by git), the manifest to `corpus/<slug>/<version>/manifest.json`, and a review report to `corpus/<slug>/<version>/review/structure.md`. It exits non-zero when a structure check fails.

## Deploying the API (staging)

The API is deployed as one prebuilt Vercel function using the Build Output API, so nothing depends on Vercel's zero-config detection of TypeScript or workspace packages.

```sh
pnpm --filter @axxiom/api build            # bundles apps/api/src/vercel-entry.ts into .vercel/output/
vercel deploy --prebuilt --prod --yes --token "$VERCEL_TOKEN"
```

- Vercel project: `axxiom-safety-api-staging` (region iad1, Node 22 runtime), production domain `https://axxiom-safety-api-staging.vercel.app`.
- Environment variables live in the Vercel project (production target); set or rotate them with `vercel env add NAME production`.
- The daily 05:45 Pacific cache warm-up runs from `config.json`; the 45-minute work-hours keep-alive needs Vercel Pro.
- Local run: `PORT=3111 INIT_CWD=$PWD node_modules/.bin/tsx apps/api/src/local.ts`, then `curl -H "Authorization: Bearer $DEV_AUTH_TOKEN" localhost:3111/v1/manual/current`.
