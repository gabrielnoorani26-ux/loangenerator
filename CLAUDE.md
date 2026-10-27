# BatchLens — notes for Claude sessions

Bulk product-photo editor: Next.js 16 (App Router) + TypeScript strict, Tailwind v4, hand-vendored shadcn/ui components on `radix-ui`, Prisma 7 + SQLite (better-sqlite3 driver adapter), sharp, DB-backed job queue, TanStack Query, zod 4, Vitest, Playwright.

Read `README.md` for product behaviour and `docs/PLAN.md` for design decisions and spec deviations.

## Commands

| Task                | Command                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Dev server + worker | `npm run dev:all` (or `npm run dev` and `npm run worker` separately)                                                                 |
| Typecheck           | `npm run typecheck` (runs `next typegen` first — needed for `RouteContext`)                                                          |
| Lint / format       | `npm run lint` · `npm run format`                                                                                                    |
| Unit tests          | `npm test` (fresh DB at `tmp/test/test.db`, files run sequentially)                                                                  |
| E2E                 | `npm run test:e2e` (port 3200, isolated `tmp/e2e`; in this container set `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium`) |
| New migration       | `npm run db:migrate -- --name <name>` then `npm run db:generate`                                                                     |
| Apply migrations    | `npm run db:deploy`                                                                                                                  |
| Seed presets        | `npm run db:seed`                                                                                                                    |
| Local model         | `npm run models` (one-time download into `./models`; `.npmrc` skips onnxruntime's CUDA fetch)                                        |
| Sample photos       | `npm run fixtures` or `npx tsx scripts/make-fixtures.ts 50 /tmp/fifty`                                                               |

## Architecture map

- `lib/settings.ts` — the single `EditSettings` zod schema (client + server). Every settings JSON in the DB must parse against it.
- `lib/prompt-builder.ts` — builds the one combined AI prompt wrapped in the Product Preservation Rule. Pure; tested.
- `lib/ai-hash.ts` — cache key = sha256(route + prompt). `lib/estimate.ts` counts calls/cost with cache hits + use-original.
- `lib/standard-edits.ts` — all sharp edits, in spec order, each step materialized to raw RGBA. Slider→sharp mappings are documented in comments.
- `lib/pipeline.ts` — per-image processing with injected storage/providers/QC (`processImage`, `runAiStep`). `onAiResult` persists AI results before standard edits (no double charge on retry).
- `lib/queue.ts` — every DB state change for jobs (start/pause/resume/cancel, claim, complete, fail+backoff, stuck recovery, requeue). Counters are recomputed (`recountBatch`) in the same transaction as status changes.
- `lib/worker.ts` — the loop: claims up to the concurrency limit, heartbeats locks, halves concurrency + pauses on 429, serializes filename assignment per batch. `scripts/worker.ts` runs it standalone; `instrumentation.ts` runs it in-app when `RUN_WORKER_IN_APP=true`.
- `lib/providers/` — `ImageEditProvider` (`local` default, `openai`, `mock`), `BackgroundRemovalProvider` (`local`, `photoroom`/`removebg`, mock), `ProviderError` mapping.
- `lib/local/` — free offline mode: `models.ts` (download + sha256), `segment.ts` (ONNX segmentation, `setSegmenter()` for tests), `edits.ts` (backgrounds/shadows/lighting/centering from structured `AiSettings`), `support.ts` (client-safe list of options local mode skips).
- `lib/qc.ts` — Anthropic vision QC (+ mock), zod parsing, retry once, fallback verdict "review".
- `lib/storage.ts` — `StorageAdapter` + `LocalStorageAdapter`, key sanitization (path-traversal safe), key layout, `thumbKeyFor`.
- `lib/export.ts` — export planning (pure) + archiver streaming. `lib/naming.ts`, `lib/smart-fill.ts` — pure, tested.
- `lib/api.ts` — `route()` wrapper → `{error: {code, message}}`, `parseBody/parseQuery` with zod. Route handlers in `app/api/**` stay thin.
- `app/batches/[id]/{upload,settings,processing,review}` — the 4-step flow. `components/settings-panel.tsx` is shared with the Presets editor.

## Conventions

- Business logic lives in `lib/`; route handlers only parse input, call `lib`, and serialize.
- All API inputs are validated with zod; errors are human-readable (no stack traces to the client).
- Server-only modules (`lib/env.ts`, `lib/db.ts`, providers) must never be imported by client components; client code may import types from them (`import type`). Client helpers live in `lib/client/`.
- Never hard-code model ids or prices: env vars only.
- Originals are never modified; new outputs get new timestamped keys and the old one becomes an `ImageVersion`.
- `next.config.ts` disables Cache Components (dynamic, local tool). Next 16 docs ship in `node_modules/next/dist/docs/` — check them before using unfamiliar Next APIs.
- React compiler lint rules are on: no `setState` directly in effects, no ref access during render. Key a child component to reset local state instead.
- archiver is v8: `new ZipArchive(...)`, not `archiver("zip")`.
- Local mode must not need network beyond the one-time model download; unit tests inject a fake segmenter and never load the real model.
- Tests: unit tests share one SQLite file and run sequentially; use `setProviders()` / `setQcProvider()` to inject fakes.
