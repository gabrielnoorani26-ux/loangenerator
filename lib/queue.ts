/**
 * DB-backed job queue. Every image status change happens in a transaction
 * together with the batch counter recount, so counters never drift.
 */
import { prisma, type BatchImage, type Prisma } from "./db";
import { logActivity } from "./activity";
import { recountBatch } from "./batches";
import { estimateRun } from "./estimate";
import { parseEditSettings } from "./settings";
import type { PipelineResult } from "./pipeline";
import { ProviderError, toProviderError } from "./providers/types";
import { ApiError, conflict, notFound } from "./api";

type Tx = Prisma.TransactionClient;

export const STUCK_AFTER_MS = 3 * 60 * 1000;
export const BACKOFF_MS = [2_000, 8_000];
const IN_FLIGHT = ["PROCESSING_AI", "PROCESSING_STANDARD"] as const;
/** Batch statuses whose QUEUED images the worker may claim (REVIEW/COMPLETE: single-image re-runs). */
const CLAIMABLE_BATCH = ["PROCESSING", "REVIEW", "COMPLETE"] as const;

export function backoffFor(retryCount: number): number {
  return BACKOFF_MS[Math.min(retryCount - 1, BACKOFF_MS.length - 1)] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
}

// ------------------------------------------------------------------ batch control

export async function startBatch(batchId: string) {
  const batch = await prisma.batch.findUnique({ where: { id: batchId } });
  if (!batch) throw notFound("Batch");
  if (batch.status === "PROCESSING" || batch.status === "PAUSED") throw conflict("Batch is already processing");
  const settings = parseEditSettings(batch.settings);
  const images = await prisma.batchImage.findMany({ where: { batchId } });
  if (images.length === 0) throw new ApiError(400, "no_images", "Upload at least one image first");
  const estimate = estimateRun(settings, images);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.batchImage.updateMany({
      where: { batchId },
      data: { status: "QUEUED", jobKind: "FULL", retryCount: 0, errorMessage: null, lockedAt: null, availableAt: null },
    });
    await tx.batch.update({
      where: { id: batchId },
      data: {
        status: "PROCESSING",
        settingsSnapshot: settings,
        estimatedCostCents: estimate.estimatedCostCents,
        startedAt: now,
        finishedAt: null,
      },
    });
    if (batch.presetId) await tx.preset.update({ where: { id: batch.presetId }, data: { usageCount: { increment: 1 } } }).catch(() => undefined);
    await recountBatch(batchId, tx);
  });
  await logActivity(
    "batch.started",
    `Processing ${images.length} images · ${estimate.aiCalls + estimate.bgRemovalCalls} AI calls estimated${estimate.cacheHits ? ` · ${estimate.cacheHits} cached` : ""}`,
    batchId,
  );
  return estimate;
}

export async function pauseBatch(batchId: string) {
  const r = await prisma.batch.updateMany({ where: { id: batchId, status: "PROCESSING" }, data: { status: "PAUSED" } });
  if (r.count === 0) throw conflict("Only a processing batch can be paused");
  await logActivity("batch.paused", null, batchId);
}

export async function resumeBatch(batchId: string) {
  const r = await prisma.batch.updateMany({ where: { id: batchId, status: "PAUSED" }, data: { status: "PROCESSING" } });
  if (r.count === 0) throw conflict("Only a paused batch can be resumed");
  await logActivity("batch.resumed", null, batchId);
  await maybeFinishBatch(batchId);
}

/** Unclaimed images stay QUEUED but are skipped; finished images are kept. */
export async function cancelBatch(batchId: string) {
  const r = await prisma.batch.updateMany({
    where: { id: batchId, status: { in: ["PROCESSING", "PAUSED"] } },
    data: { status: "CANCELLED", finishedAt: new Date() },
  });
  if (r.count === 0) throw conflict("Only a processing or paused batch can be cancelled");
  await logActivity("batch.cancelled", null, batchId);
}

/** Move PROCESSING → REVIEW when nothing is queued or in flight. */
export async function maybeFinishBatch(batchId: string, tx: Tx | typeof prisma = prisma): Promise<boolean> {
  const batch = await tx.batch.findUnique({ where: { id: batchId }, select: { status: true } });
  if (batch?.status !== "PROCESSING") return false;
  const remaining = await tx.batchImage.count({ where: { batchId, status: { in: ["QUEUED", ...IN_FLIGHT] } } });
  if (remaining > 0) return false;
  const r = await tx.batch.updateMany({ where: { id: batchId, status: "PROCESSING" }, data: { status: "REVIEW", finishedAt: new Date() } });
  if (r.count > 0) {
    const b = await tx.batch.findUnique({ where: { id: batchId } });
    await logActivity(
      "batch.finished",
      `${b?.completedCount ?? 0} done · ${b?.failedCount ?? 0} failed · ${b?.aiCallsUsed ?? 0} AI calls used`,
      batchId,
    );
  }
  return r.count > 0;
}

// ------------------------------------------------------------------ requeue (review actions)

export interface RequeueOptions {
  kind: "FULL" | "STANDARD";
  /** For AI re-runs: replaces the per-image instruction (null clears it; undefined keeps it) */
  instruction?: string | null;
  /** FULL re-run that must call the AI even if a cached result exists */
  forceAi?: boolean;
  useOriginal?: boolean;
}

/**
 * Queue images for re-processing. Batch must already have a settings snapshot.
 * Returns the number of images queued.
 */
export async function requeueImages(batchId: string, ids: string[], opts: RequeueOptions): Promise<number> {
  const batch = await prisma.batch.findUnique({ where: { id: batchId } });
  if (!batch) throw notFound("Batch");
  if (!batch.settingsSnapshot) throw conflict("Process the batch before re-running images");
  if (batch.status === "CANCELLED") throw conflict("This batch was cancelled");
  const count = await prisma.$transaction(async (tx) => {
    const data: Prisma.BatchImageUpdateManyMutationInput = {
      status: "QUEUED",
      jobKind: opts.kind,
      retryCount: 0,
      errorMessage: null,
      lockedAt: null,
      availableAt: null,
    };
    if (opts.instruction !== undefined) data.perImageInstruction = opts.instruction?.trim() || null;
    if (opts.useOriginal !== undefined) data.useOriginal = opts.useOriginal;
    // Forcing a new AI call: drop the cache hash so the pipeline can't reuse it.
    if (opts.forceAi) data.aiSettingsHash = null;
    const r = await tx.batchImage.updateMany({
      where: { batchId, id: { in: ids }, status: { notIn: [...IN_FLIGHT] } },
      data,
    });
    await recountBatch(batchId, tx);
    return r.count;
  });
  return count;
}

// ------------------------------------------------------------------ worker operations

export interface ClaimedJob {
  image: BatchImage;
  lockedAt: Date;
}

/**
 * Claim up to `limit` QUEUED images across all claimable batches, oldest batch
 * first. Each claim is a conditional update (status must still be QUEUED), so
 * two workers can never claim the same image.
 */
export async function claimJobs(limit: number, now = new Date()): Promise<ClaimedJob[]> {
  if (limit <= 0) return [];
  const candidates = await prisma.batchImage.findMany({
    where: {
      status: "QUEUED",
      batch: { status: { in: [...CLAIMABLE_BATCH] } },
      OR: [{ availableAt: null }, { availableAt: { lte: now } }],
    },
    orderBy: [{ batch: { startedAt: "asc" } }, { sortOrder: "asc" }],
    take: limit * 3,
  });
  const claimed: ClaimedJob[] = [];
  for (const c of candidates) {
    if (claimed.length >= limit) break;
    const lockedAt = new Date(now.getTime() + claimed.length); // unique per claim
    const status = c.jobKind === "STANDARD" ? "PROCESSING_STANDARD" : "PROCESSING_AI";
    const won = await prisma.$transaction(async (tx) => {
      const r = await tx.batchImage.updateMany({ where: { id: c.id, status: "QUEUED" }, data: { status, lockedAt } });
      if (r.count === 1) await recountBatch(c.batchId, tx);
      return r.count === 1;
    });
    if (won) claimed.push({ image: { ...c, status, lockedAt }, lockedAt });
  }
  return claimed;
}

/** Refresh the lock so long AI calls aren't mistaken for stuck jobs. Returns the new token or null if lost. */
export async function heartbeat(job: ClaimedJob): Promise<Date | null> {
  const next = new Date();
  const r = await prisma.batchImage.updateMany({ where: { id: job.image.id, lockedAt: job.lockedAt }, data: { lockedAt: next } });
  if (r.count === 1) {
    job.lockedAt = next;
    return next;
  }
  return null;
}

export async function setPhase(job: ClaimedJob, phase: "AI" | "STANDARD") {
  await prisma.$transaction(async (tx) => {
    const r = await tx.batchImage.updateMany({
      where: { id: job.image.id, lockedAt: job.lockedAt },
      data: { status: phase === "AI" ? "PROCESSING_AI" : "PROCESSING_STANDARD" },
    });
    if (r.count) await recountBatch(job.image.batchId, tx);
  });
}

/** Record a fresh AI result immediately (cache + billing), independent of the rest of the job. */
export async function recordAiResult(job: ClaimedJob, r: { key: string; hash: string; route: "edit" | "white-bg" }) {
  await prisma.$transaction(async (tx) => {
    await tx.batchImage.update({ where: { id: job.image.id }, data: { aiIntermediateKey: r.key, aiSettingsHash: r.hash } });
    await tx.batch.update({ where: { id: job.image.batchId }, data: { aiCallsUsed: { increment: 1 } } });
    await tx.usageEvent.create({ data: { batchId: job.image.batchId, kind: r.route === "white-bg" ? "bg_removal" : "ai_edit" } });
  });
}

/** Persist a successful run. Returns false if the job lost its lock (another worker reclaimed it). */
export async function completeJob(job: ClaimedJob, result: PipelineResult): Promise<boolean> {
  const img = job.image;
  const ok = await prisma.$transaction(async (tx) => {
    const current = await tx.batchImage.findUnique({ where: { id: img.id } });
    if (!current || current.lockedAt?.getTime() !== job.lockedAt.getTime()) return false;
    // Keep the previous output as a version before overwriting.
    if (current.editedKey && current.editedKey !== result.editedKey) {
      await tx.imageVersion.create({
        data: {
          imageId: img.id,
          aiIntermediateKey: current.aiIntermediateKey,
          aiSettingsHash: current.aiSettingsHash,
          editedKey: current.editedKey,
          outputWidth: current.outputWidth,
          outputHeight: current.outputHeight,
          outputSizeKb: current.outputSizeKb,
          instruction: current.perImageInstruction,
          qcScore: current.qcScore,
        },
      });
    }
    const qcData =
      result.qc === undefined
        ? {}
        : result.qc === null
          ? { qcScore: null, qcIssues: null, qcVerdict: null }
          : { qcScore: result.qc.score, qcIssues: JSON.stringify(result.qc.issues), qcVerdict: result.qc.verdict };
    await tx.batchImage.update({
      where: { id: img.id },
      data: {
        status: "DONE",
        lockedAt: null,
        availableAt: null,
        errorMessage: null,
        jobKind: "FULL",
        aiIntermediateKey: result.aiIntermediateKey,
        aiSettingsHash: result.aiSettingsHash,
        editedKey: result.editedKey,
        outputFilename: result.outputFilename,
        outputWidth: result.outputWidth,
        outputHeight: result.outputHeight,
        outputSizeKb: result.outputSizeKb,
        ...qcData,
      },
    });
    if (result.qc && !(result.qc.issues.length === 1 && result.qc.issues[0] === "QC could not be completed")) {
      await tx.usageEvent.create({ data: { batchId: img.batchId, kind: "qc" } });
    }
    await recountBatch(img.batchId, tx);
    return true;
  });
  if (ok) await maybeFinishBatch(img.batchId);
  return ok;
}

export interface FailOutcome {
  retried: boolean;
  delayMs: number;
  error: ProviderError;
}

/**
 * Record a failure: retryable errors are re-queued with exponential backoff
 * (2 s, 8 s) until maxRetries; rate limits honor Retry-After and don't consume
 * a retry. Anything else → FAILED with a human-readable message.
 */
export async function failJob(job: ClaimedJob, err: unknown, maxRetries: number): Promise<FailOutcome> {
  const perr = toProviderError(err);
  const img = job.image;
  const isRateLimit = perr.kind === "rate_limit";
  const nextRetry = isRateLimit ? img.retryCount : img.retryCount + 1;
  const retry = perr.retryable && (isRateLimit || nextRetry <= maxRetries);
  const delayMs = isRateLimit ? Math.max(perr.retryAfterMs ?? 0, 2_000) : backoffFor(nextRetry);
  await prisma.$transaction(async (tx) => {
    const current = await tx.batchImage.findUnique({ where: { id: img.id }, select: { lockedAt: true } });
    if (current?.lockedAt?.getTime() !== job.lockedAt.getTime()) return;
    await tx.batchImage.update({
      where: { id: img.id },
      data: retry
        ? { status: "QUEUED", lockedAt: null, retryCount: nextRetry, availableAt: new Date(Date.now() + delayMs), errorMessage: perr.userMessage }
        : { status: "FAILED", lockedAt: null, retryCount: nextRetry, availableAt: null, errorMessage: humanError(err, perr) },
    });
    await recountBatch(img.batchId, tx);
  });
  if (!retry) await maybeFinishBatch(img.batchId);
  return { retried: retry, delayMs, error: perr };
}

function humanError(raw: unknown, perr: ProviderError): string {
  if (raw instanceof ProviderError) return raw.userMessage;
  // Non-provider failures (e.g. a corrupt file in sharp): short, no stack trace.
  const msg = raw instanceof Error ? raw.message.split("\n")[0].slice(0, 160) : "";
  return msg && perr.kind === "unknown" ? `Processing failed: ${msg}` : perr.userMessage;
}

/** Reset images stuck in PROCESSING_* (lock older than 3 min) back to QUEUED. */
export async function recoverStuck(now = new Date(), excludeIds: Set<string> = new Set()): Promise<number> {
  const cutoff = new Date(now.getTime() - STUCK_AFTER_MS);
  const stuck = await prisma.batchImage.findMany({
    where: { status: { in: [...IN_FLIGHT] }, OR: [{ lockedAt: { lt: cutoff } }, { lockedAt: null }] },
    select: { id: true, batchId: true },
  });
  let n = 0;
  const batches = new Set<string>();
  for (const s of stuck) {
    if (excludeIds.has(s.id)) continue;
    const r = await prisma.batchImage.updateMany({
      where: { id: s.id, status: { in: [...IN_FLIGHT] }, OR: [{ lockedAt: { lt: cutoff } }, { lockedAt: null }] },
      data: { status: "QUEUED", lockedAt: null, availableAt: null },
    });
    if (r.count) {
      n++;
      batches.add(s.batchId);
    }
  }
  for (const b of batches) await recountBatch(b);
  if (n) console.log(`[queue] recovered ${n} stuck image(s)`);
  return n;
}
