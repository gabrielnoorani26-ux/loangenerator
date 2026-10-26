# Implementation plan & decisions (Phase 0)

## File tree

```
app/
  page.tsx                         Dashboard
  batches/[id]/{upload,settings,processing,review}/page.tsx
  presets/ settings/ activity/     Other pages
  api/                             Thin, zod-validated route handlers (see README for the list)
components/
  ui/                              shadcn-style primitives (vendored on radix-ui)
  settings-panel.tsx               EditSettings editor (batch Settings + Presets)
  before-after.tsx zoom-compare.tsx review/{image-detail,rerun-dialog,export-dialog}.tsx
lib/
  settings.ts prompt-builder.ts ai-hash.ts estimate.ts standard-edits.ts pipeline.ts
  queue.ts worker.ts progress.ts qc.ts export.ts naming.ts smart-fill.ts ingest.ts
  storage.ts db.ts env.ts api.ts image-actions.ts stats.ts presets.ts preset-seeds.ts
  providers/{types,openai,bg-removal,mock,index}.ts
  client/                          Client-only helpers (fetch, hooks, routes)
prisma/ schema.prisma seed.ts migrations/
scripts/ worker.ts make-fixtures.ts
tests/ unit/*.test.ts e2e/happy-path.spec.ts
```

## Phase checklist

0. Plan + provider docs ✔ · 1. Foundation ✔ · 2. Upload ✔ · 3. Standard edits + preview ✔ · 4. Queue + mock AI ✔ (50-image crash/restart test) · 5. Real AI providers ✔ (no live verification, see below) · 6. QC ✔ (mocked/injected verification) · 7. Review & export ✔ · 8. Presets/Settings/Activity/Dashboard ✔ · 9. Hardening, docs ✔

## Provider research (current SDKs)

- **Image editing: OpenAI Images Edit** (`client.images.edit`, openai@7). Chosen for instruction-following edits with a reference image. From the SDK typings: GPT image models accept PNG/WEBP/JPG < 50 MB, always return base64, `input_fidelity` is supported on gpt-image-1/1.5 only (omit for gpt-image-2), gpt-image-2+ accept arbitrary `WIDTHxHEIGHT` (multiples of 16, aspect 1:3–3:1, max 3840×2160, >2560×1440 experimental); `gpt-image-1` was shut down 2026-10-23. The model comes from `IMAGE_PROVIDER_MODEL`.
- **Background removal: Photoroom `/v1/segment`** (remove.bg-compatible fields: `image_file`, `bg_color`, `format`, `size`) or **remove.bg `/v1.0/removebg`**. One implementation serves both.
- **QC: Anthropic Messages API** (`@anthropic-ai/sdk@1`), two base64 JPEG image blocks + the spec instruction, `output_config.effort: "low"`, server-side refusal fallback enabled for models that support it. Model from `ANTHROPIC_QC_MODEL`.
- The OpenAI, Photoroom and remove.bg documentation hosts and API hosts were blocked by this build environment's network policy, so the code was written against the installed SDK typings and published docs summaries; none of the three was called live. Pricing pages were also unreachable, so cost-per-call is configurable (`AI_COST_PER_CALL_CENTS`, `BG_REMOVAL_COST_PER_CALL_CENTS`).

## Spec conflicts and the closest alternative chosen

| Spec                                                  | Issue                                                                                                          | Chosen alternative                                                                                                                      |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| "Switching to Postgres is a one-line provider change" | Prisma 7 requires a driver adapter                                                                             | Provider line + adapter import in `lib/db.ts` (documented)                                                                              |
| QC compares "original and edited"                     | The final output includes deliberate crops/color adjustments that a vision model would flag as product changes | QC compares the original with the **AI result** (pre-standard edits); QC is re-run only when a new AI result is produced                |
| AI result downscale to ≤4096 px                       | OpenAI outputs are capped (≤3840×2160, multiples of 16)                                                        | Input ≤4096 px as specified; output requested at ≤2048 px matched to aspect; standard edits handle final sizing                         |
| shadcn/ui via CLI                                     | The shadcn registry was unreachable                                                                            | Same components vendored by hand on `radix-ui` (identical API/class conventions)                                                        |
| Spec schema                                           | Needed working settings, retry scheduling, job type and per-call usage history                                 | Added `Batch.settings`, `BatchImage.availableAt` / `jobKind`, extra `ImageVersion` fields, and a `UsageEvent` table (AI calls by month) |
| Retries "on error"                                    | Counting HTTP 429 waits as retries fails big batches during provider throttling                                | 429s honor Retry-After and halve concurrency for 60 s but don't consume a retry; other transient errors back off 2 s → 8 s              |
| Exact resize + "lock aspect ratio"                    | Undefined combination                                                                                          | Locked = cover (exact size, edges cropped, no distortion); unlocked = stretch                                                           |
| Cancel                                                | Unclaimed images "stay QUEUED"                                                                                 | Implemented literally; cancelled batches open in Review and can be exported                                                             |
| "Strip metadata" toggle off                           | sharp works on decoded pixels                                                                                  | Keeps an sRGB ICC profile plus descriptive EXIF (artist, copyright, description, camera)                                                |
| Next.js 16 defaults                                   | `cacheComponents` is on in new apps                                                                            | Disabled: every page is dynamic local data                                                                                              |
