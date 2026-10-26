# BatchLens — AI Bulk Product Photo Editor

Local-first web app for bulk-editing product photos (built for footwear wholesale and e-commerce). Upload 100–200 photos, configure AI + standard edits once, process them on a crash-safe server-side queue, review and fix individual results, and export organized ZIPs.

- **Originals are never modified.** Every edit writes a new file; previous outputs are kept as versions.
- **AI credits are protected.** All AI edits for an image are combined into one call, results are cached by a hash of the AI prompt, standard-only changes never call the AI, and an AI result is saved the moment it arrives so a later failure never causes a second charge.
- **Processing survives refreshes, closed tabs and server restarts.** The job queue lives in the database.
- **One failed image never stops a batch.** Failures retry with backoff and then surface with a human-readable reason.
- **Product preservation.** Every AI prompt is wrapped in a strict preservation rule, and an automated vision QC flags images where the product may have been altered.

## Quick start

Requires Node.js 22+.

```bash
npm install                 # also runs `prisma generate`
cp .env.example .env        # defaults: SQLite + mock AI provider (no spend)
npx prisma migrate deploy   # create the SQLite database
npm run db:seed             # the six built-in presets
npm run dev:all             # Next.js on :3000 + the queue worker
```

Open http://localhost:3000, click **New batch**, and drop in photos. To try it without your own photos, `npm run fixtures` writes sample images to `/fixtures`.

### Running the app and the worker

The queue worker is a separate long-running process:

| Command                      | What it runs                                            |
| ---------------------------- | ------------------------------------------------------- |
| `npm run dev`                | Next.js only (no processing happens without a worker)   |
| `npm run worker`             | The queue worker only                                   |
| `npm run dev:all`            | Both, in one terminal                                   |
| `npm run build && npm start` | Production server (start `npm run worker` alongside it) |

Alternatively, set `RUN_WORKER_IN_APP=true` to start the worker inside the Next.js server process (via `instrumentation.ts`). **Run exactly one worker per database**: the concurrency limit is per process.

## Environment variables

All keys are read server-side only (never `NEXT_PUBLIC_`). See `.env.example` for the documented defaults.

| Variable                           | Default             | Purpose                                                                             |
| ---------------------------------- | ------------------- | ----------------------------------------------------------------------------------- |
| `DATABASE_URL`                     | `file:./dev.db`     | SQLite file (see "Switching to Postgres")                                           |
| `STORAGE_DIR`                      | `./storage`         | Originals, AI intermediates, outputs, thumbnails                                    |
| `IMAGE_PROVIDER`                   | `mock`              | `openai` or `mock`                                                                  |
| `IMAGE_PROVIDER_API_KEY`           | —                   | Key for the image provider                                                          |
| `IMAGE_PROVIDER_MODEL`             | `gpt-image-2`       | Model id (never hard-coded; check the provider's current list)                      |
| `OPENAI_IMAGE_QUALITY`             | `high`              | `low` / `medium` / `high` / `auto` (newer models: `xhigh`, `max`)                   |
| `OPENAI_INPUT_FIDELITY`            | —                   | `high` only for models that support it (gpt-image-1.5); leave empty for gpt-image-2 |
| `BG_REMOVAL_PROVIDER`              | —                   | `photoroom` or `removebg`; used only for "white background" with no other AI edits  |
| `BG_REMOVAL_API_KEY`               | —                   | If empty, the main image provider is used instead                                   |
| `ANTHROPIC_API_KEY`                | —                   | Vision QC. Without it QC is skipped (or mocked when `IMAGE_PROVIDER=mock`)          |
| `ANTHROPIC_QC_MODEL`               | `claude-opus-5-5`   | Model for QC                                                                        |
| `AI_COST_PER_CALL_CENTS`           | `8`                 | Used for cost estimates only — set from your provider's pricing                     |
| `BG_REMOVAL_COST_PER_CALL_CENTS`   | `2`                 | Same, for background removal                                                        |
| `MAX_CONCURRENT_AI_CALLS`          | `3`                 | Initial value; the Settings page (1–5) overrides it                                 |
| `MAX_RETRIES`                      | `2`                 | Initial value; the Settings page (0–5) overrides it                                 |
| `MAX_UPLOAD_MB`                    | `25`                | Per-file upload limit                                                               |
| `RUN_WORKER_IN_APP`                | `false`             | Run the worker inside the Next.js server                                            |
| `MOCK_FAIL_RATE` / `MOCK_DELAY_MS` | `0.1` / `1000-3000` | Mock provider behaviour (tests use `0` / `0-0`)                                     |

## How it works

```
Upload ─► Settings ─► Process ─► Review & Export
  │          │           │             │
  │          │           │             ├─ approve / reject (single, bulk, keyboard)
  │          │           │             ├─ re-run AI with an instruction (shows cost first)
  │          │           │             ├─ re-apply standard edits (free) / use original / revert to version
  │          │           │             └─ streamed ZIP export (parts of 100, grouping, manifest.csv)
  │          │           └─ DB-backed queue + worker (claims, retries, 429 handling, stuck recovery)
  │          └─ live standard-edit preview, "Test AI on this image" (cached for the run), cost estimate
  └─ HEIC→JPG, signature validation, thumbnails, drag-to-reorder, smart fill from filenames
```

Per image (`lib/pipeline.ts`): **AI step** (only if AI edits or a per-image instruction apply and the image isn't set to "use original": reuse the cached result if the prompt hash matches, else downscale to ≤4096 px and make one provider call) → **standard edits** with sharp, in order: auto-trim → crop to aspect → fit to canvas → resize → adjustments → watermark → flatten (JPG) → encode → step quality down by 5 to meet max KB (floor 50) → strip metadata → **naming** (pattern tokens, de-duplicated within the batch) → **QC** when a new AI result was produced.

## Adding a new AI provider

1. Implement `ImageEditProvider` (`lib/providers/types.ts`): `edit({ image, mime, width, height, prompt, signal })` returns image bytes, and `testConnection()` makes the cheapest authenticated request.
2. Map provider failures to `ProviderError` kinds (`rate_limit`, `content_policy`, `too_large`, `timeout`, `auth`, …) — `errorFromStatus()` handles the common HTTP cases, and `retryAfterMs` is honored by the worker.
3. Register it in `getImageEditProvider()` in `lib/providers/index.ts` under a new `IMAGE_PROVIDER` value.
4. Read model ids and keys from env vars; never hard-code them.
5. Add unit tests next to `tests/unit/providers.test.ts`; use `IMAGE_PROVIDER=mock` for everything else.

A background-removal provider implements `BackgroundRemovalProvider.removeToWhite()` and is registered in `getBackgroundRemovalProvider()`.

## Cost notes

- One AI call per image per run, no matter how many AI options are enabled.
- The cache key is a SHA-256 of the final prompt (plus routing), so changing only standard edits, output format or naming never re-charges. Re-starting a batch with the same AI settings costs nothing.
- "Test AI on this image" stores its result on the image; the batch run reuses it.
- "Re-run AI" always makes a new call (that is its purpose) and shows the call count and estimate before running.
- "Re-apply standard edits" and "Use original" never call the AI.
- Failed calls are retried at most `maxRetries` times (rate-limit waits don't count as retries).
- Estimates use `AI_COST_PER_CALL_CENTS` / `BG_REMOVAL_COST_PER_CALL_CENTS`; set them from your providers' current pricing pages.
- QC sends two ≤1024 px JPEGs per AI result at low effort.

## Tests

```bash
npm run typecheck   # next typegen + tsc --noEmit (strict)
npm run lint
npm test            # Vitest unit tests (fresh SQLite DB in tmp/test)
npm run test:e2e    # Playwright happy path: upload → settings → process (mock) → approve → export
```

The e2e test runs its own server on port 3200 with an isolated database/storage under `tmp/e2e`, the mock provider and the in-app worker. Install a browser once with `npx playwright install chromium`, or point `PLAYWRIGHT_CHROMIUM_EXECUTABLE` at an existing Chromium.

## Switching to Postgres

Prisma 7 uses driver adapters, so the switch is two small edits rather than one line:

1. `prisma/schema.prisma`: `provider = "postgresql"`.
2. `lib/db.ts`: replace `PrismaBetterSqlite3` with `PrismaPg` from `@prisma/adapter-pg`.

Then set `DATABASE_URL` and run `npx prisma migrate dev` to create fresh Postgres migrations. JSON-in-string columns (`tags`, `qcIssues`, `brandList`, `watermarkLibrary`) work unchanged. For cloud storage, implement `StorageAdapter` (`lib/storage.ts`) for S3/R2.

## Known limitations

- **Real providers are unverified in this build.** The OpenAI and Anthropic integrations were written against the current SDK typings (`openai@7`, `@anthropic-ai/sdk@1`) and unit-tested with injected fetches/mocks, but no live call was made. The Photoroom/remove.bg integration follows their documented remove.bg-compatible API, also unverified live. Run _Settings → Test API connections_ and a 2–3 image test batch before a big run.
- **OpenAI output resolution.** GPT image models return at most 3840×2160 (sizes above 2560×1440 are experimental); BatchLens requests ≤2048 px on the long edge, matched to the photo's aspect ratio. For very large outputs the AI result is upscaled by the standard edits.
- **QC compares the original with the AI result**, before standard edits, so deliberate crops/adjustments aren't flagged as product changes. It is a safety net, not a guarantee.
- **Instagram Lifestyle preset** center-crops to 4:5, which cuts the toe/heel off wide side shots. Prefer fit-to-canvas 1080×1350 for those.
- **Stuck recovery** waits until a job's lock is 3 minutes old, so after a crash the in-flight images resume about 3 minutes later.
- **"Strip metadata" off** keeps an sRGB profile plus descriptive EXIF (artist, copyright, description, camera), not the full original metadata block.
- **Exports** are assembled in the browser per part (≤100 images) before saving, so very large parts need a matching amount of memory in the tab.
- Single user, no auth. The `StorageAdapter`/provider interfaces and API layering are ready for auth and cloud storage later.
