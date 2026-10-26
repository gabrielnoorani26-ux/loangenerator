/**
 * Per-image processing pipeline (spec §4). Storage, providers and QC are
 * injected so this is unit-testable without the DB or network. The queue
 * (lib/queue.ts) owns all DB writes.
 */
import sharp from "sharp";
import { aiSettingsHash } from "./ai-hash";
import { renderPattern, uniqueFilename } from "./naming";
import { buildPrompt } from "./prompt-builder";
import type { BackgroundRemovalProvider, ImageEditProvider } from "./providers/types";
import { runQc, type QcProvider, type QcResult } from "./qc";
import { imageNeedsAi, isPureWhiteBackgroundOnly, type EditSettings } from "./settings";
import { applyStandardEdits, EXT_FOR_FORMAT } from "./standard-edits";
import { keys, thumbKeyFor, type StorageAdapter } from "./storage";
import { makeThumbnail } from "./ingest";
import { loadWatermarkAssets } from "./watermarks";

export const AI_MAX_INPUT_SIDE = 4096;

export interface PipelineImage {
  id: string;
  batchId: string;
  originalKey: string;
  originalFilename: string;
  aiIntermediateKey: string | null;
  aiSettingsHash: string | null;
  perImageInstruction: string | null;
  useOriginal: boolean;
  styleCode: string | null;
  colorName: string | null;
  viewAngle: string | null;
  qcScore: number | null;
  /** 1-based position in the batch, for {index} */
  index: number;
}

export interface PipelineContext {
  settings: EditSettings;
  batchName: string;
  brand: string;
  /** "FULL" = AI (if needed) + standard; "STANDARD" = standard edits only, never calls AI */
  jobKind: "FULL" | "STANDARD";
  /** Lower-cased output filenames already used by other images in the batch */
  takenNames: Set<string>;
  autoQc: boolean;
  qcThreshold: number;
  now: Date;
}

export interface PipelineDeps {
  storage: StorageAdapter;
  editProvider: () => ImageEditProvider;
  bgProvider: () => BackgroundRemovalProvider | null;
  qcProvider: () => QcProvider | null;
  /** Called when the job moves to the standard-edit phase (status update). */
  onPhase?: (phase: "AI" | "STANDARD") => Promise<void> | void;
  /**
   * Called right after a new AI result is stored, before standard edits, so it
   * is cached (and billed) even if a later step fails — a retry never pays twice.
   */
  onAiResult?: (r: { key: string; hash: string; route: "edit" | "white-bg" }) => Promise<void> | void;
  signal?: AbortSignal;
}

export interface PipelineResult {
  aiCalled: boolean;
  aiRoute: "edit" | "white-bg" | null;
  aiIntermediateKey: string | null;
  aiSettingsHash: string | null;
  editedKey: string;
  outputFilename: string;
  outputWidth: number;
  outputHeight: number;
  outputSizeKb: number;
  /** undefined = QC not run this time (keep existing); null = no AI used, clear QC */
  qc?: QcResult | null;
}

/** Prepare an image for the AI provider: oriented, ≤4096px, PNG if it has alpha else high-quality JPEG. */
export async function prepareAiInput(
  original: Buffer,
): Promise<{ data: Buffer; mime: "image/png" | "image/jpeg"; width: number; height: number }> {
  const base = sharp(original)
    .rotate()
    .resize(AI_MAX_INPUT_SIDE, AI_MAX_INPUT_SIDE, { fit: "inside", withoutEnlargement: true });
  const meta = await sharp(original).metadata();
  const out = meta.hasAlpha
    ? await base.png().toBuffer({ resolveWithObject: true })
    : await base.jpeg({ quality: 95 }).toBuffer({ resolveWithObject: true });
  return {
    data: out.data,
    mime: meta.hasAlpha ? "image/png" : "image/jpeg",
    width: out.info.width,
    height: out.info.height,
  };
}

/**
 * Run (or reuse) the single AI call for an image. Returns null when the image
 * needs no AI. Never called for STANDARD jobs.
 */
export async function runAiStep(
  image: PipelineImage,
  settings: EditSettings,
  deps: PipelineDeps,
): Promise<{ key: string; hash: string; called: boolean; route: "edit" | "white-bg" } | null> {
  if (!imageNeedsAi(settings.ai, image)) return null;
  const hash = aiSettingsHash(settings.ai, image.perImageInstruction)!;
  const route = isPureWhiteBackgroundOnly(settings.ai, image.perImageInstruction) ? "white-bg" : "edit";
  // Cache hit: same AI settings + instruction already produced a result.
  if (
    image.aiIntermediateKey &&
    image.aiSettingsHash === hash &&
    (await deps.storage.exists(image.aiIntermediateKey))
  ) {
    return { key: image.aiIntermediateKey, hash, called: false, route };
  }
  const original = await deps.storage.get(image.originalKey);
  const input = await prepareAiInput(original);
  let result: Buffer;
  const bg = route === "white-bg" ? deps.bgProvider() : null;
  if (bg) {
    result = await bg.removeToWhite(input.data, deps.signal);
  } else {
    const prompt = buildPrompt(settings.ai, image.perImageInstruction)!;
    result = await deps.editProvider().edit({
      image: input.data,
      mime: input.mime,
      width: input.width,
      height: input.height,
      prompt,
      signal: deps.signal,
    });
  }
  // Normalize to PNG so intermediates are lossless and format-independent.
  const png = await sharp(result).png().toBuffer();
  const key = keys.ai(image.batchId, image.id, hash);
  await deps.storage.put(key, png);
  await deps.storage.put(thumbKeyFor(key), await makeThumbnail(png));
  const out = { key, hash, called: true, route: (bg ? "white-bg" : "edit") as "edit" | "white-bg" };
  await deps.onAiResult?.(out);
  return out;
}

export async function processImage(
  image: PipelineImage,
  ctx: PipelineContext,
  deps: PipelineDeps,
): Promise<PipelineResult> {
  const { settings } = ctx;
  let ai: Awaited<ReturnType<typeof runAiStep>> = null;

  if (ctx.jobKind === "FULL" && !image.useOriginal) {
    await deps.onPhase?.("AI");
    ai = await runAiStep(image, settings, deps);
  }
  await deps.onPhase?.("STANDARD");

  // STANDARD jobs reuse whatever AI result the image already has (zero AI cost).
  const aiKey = image.useOriginal
    ? null
    : ctx.jobKind === "FULL"
      ? (ai?.key ?? null)
      : image.aiIntermediateKey && (await deps.storage.exists(image.aiIntermediateKey))
        ? image.aiIntermediateKey
        : null;

  const original = await deps.storage.get(image.originalKey);
  const source = aiKey ? await deps.storage.get(aiKey) : original;
  const assets = await loadWatermarkAssets(settings.standard.watermark);
  const out = await applyStandardEdits(source, settings.standard, settings.output, {
    assets,
    metadataSource: original,
  });

  const ext = EXT_FOR_FORMAT[settings.output.format];
  const stamp = ctx.now.getTime();
  const editedKey = keys.edited(image.batchId, image.id, ext, stamp);
  await deps.storage.put(editedKey, out.data);
  await deps.storage.put(thumbKeyFor(editedKey), await makeThumbnail(out.data));

  const base = renderPattern(settings.output.namingPattern, {
    originalFilename: image.originalFilename,
    batchName: ctx.batchName,
    brand: ctx.brand,
    styleCode: image.styleCode,
    colorName: image.colorName,
    viewAngle: image.viewAngle,
    index: image.index,
    date: ctx.now,
    width: out.width,
    height: out.height,
  });
  const outputFilename = uniqueFilename(base, ext, ctx.takenNames);

  // QC compares the original with the AI result (before standard edits), so
  // deliberate standard adjustments (crop, warmth…) are never flagged as product
  // changes. Re-run only when a new AI result was produced or none exists yet.
  let qc: QcResult | null | undefined = aiKey ? undefined : null;
  const qcProvider = ctx.autoQc && aiKey ? deps.qcProvider() : null;
  if (qcProvider && aiKey && (ai?.called || image.qcScore == null)) {
    qc = await runQc(qcProvider, original, await deps.storage.get(aiKey), ctx.qcThreshold);
  }

  return {
    aiCalled: Boolean(ai?.called),
    aiRoute: ai?.called ? ai.route : null,
    // Keep any previous AI result cached even when this run didn't use it.
    aiIntermediateKey: ai ? ai.key : image.aiIntermediateKey,
    aiSettingsHash: ai ? ai.hash : image.aiSettingsHash,
    editedKey,
    outputFilename,
    outputWidth: out.width,
    outputHeight: out.height,
    outputSizeKb: out.sizeKb,
    qc,
  };
}
