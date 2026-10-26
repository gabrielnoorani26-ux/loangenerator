import { z } from "zod";
import { prisma, type Batch, type BatchImage } from "./db";
import { parseJsonArray } from "./json";
import { EditSettingsSchema, parseEditSettings } from "./settings";
import { fileUrl, thumbKeyFor } from "./storage";
import { getAppSettings } from "./app-settings";

export const BATCH_STATUSES = ["DRAFT", "READY", "PROCESSING", "PAUSED", "REVIEW", "COMPLETE", "CANCELLED"] as const;
export const VIEW_ANGLES = ["SIDE", "FRONT", "BACK", "TOP", "SOLE", "PAIR", "DETAIL", "LIFESTYLE", "OTHER"] as const;
export const IMAGE_STATUSES = [
  "QUEUED",
  "PROCESSING_AI",
  "PROCESSING_STANDARD",
  "DONE",
  "FAILED",
  "APPROVED",
  "REJECTED",
] as const;

export const BatchCreateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  brand: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(1000).optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  presetId: z.string().optional().nullable(),
});

export const BatchUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  brand: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(1000).optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  presetId: z.string().nullable().optional(),
  settings: EditSettingsSchema.optional(),
  status: z.enum(["DRAFT", "READY", "COMPLETE"]).optional(),
});

export function defaultBatchName(date = new Date()): string {
  return `Batch – ${date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

export async function initialSettingsFor(presetId?: string | null) {
  const app = await getAppSettings();
  const id = presetId ?? app.defaultPresetId;
  const preset = id ? await prisma.preset.findUnique({ where: { id } }) : await prisma.preset.findFirst({ where: { isDefault: true } });
  const settings = parseEditSettings(preset?.settings);
  if (!preset) settings.output.namingPattern = app.defaultNamingPattern;
  return { settings, presetId: preset?.id ?? null };
}

/** QC "needs review" = done but flagged by QC. */
export function needsReview(img: Pick<BatchImage, "status" | "qcVerdict">): boolean {
  return img.status === "DONE" && img.qcVerdict === "review";
}

export function serializeImage(img: BatchImage) {
  const editedThumb = img.editedKey ? thumbKeyFor(img.editedKey) : null;
  return {
    id: img.id,
    batchId: img.batchId,
    sortOrder: img.sortOrder,
    originalFilename: img.originalFilename,
    originalWidth: img.originalWidth,
    originalHeight: img.originalHeight,
    originalSizeKb: img.originalSizeKb,
    originalMime: img.originalMime,
    originalUrl: fileUrl(img.originalKey),
    originalThumbUrl: fileUrl(thumbKeyFor(img.originalKey)),
    aiUrl: fileUrl(img.aiIntermediateKey),
    hasAiResult: Boolean(img.aiIntermediateKey),
    editedUrl: fileUrl(img.editedKey),
    editedThumbUrl: fileUrl(editedThumb),
    outputFilename: img.outputFilename,
    outputWidth: img.outputWidth,
    outputHeight: img.outputHeight,
    outputSizeKb: img.outputSizeKb,
    status: img.status,
    errorMessage: img.errorMessage,
    retryCount: img.retryCount,
    perImageInstruction: img.perImageInstruction,
    useOriginal: img.useOriginal,
    jobKind: img.jobKind,
    qcScore: img.qcScore,
    qcIssues: parseJsonArray<string>(img.qcIssues),
    qcVerdict: img.qcVerdict,
    needsReview: needsReview(img),
    styleCode: img.styleCode,
    colorName: img.colorName,
    viewAngle: img.viewAngle,
    updatedAt: img.updatedAt,
  };
}
export type ImageDTO = ReturnType<typeof serializeImage>;

export function serializeBatch(b: Batch & { images?: BatchImage[]; preset?: { name: string } | null }) {
  return {
    id: b.id,
    name: b.name,
    description: b.description,
    brand: b.brand,
    status: b.status,
    presetId: b.presetId,
    presetName: b.preset?.name ?? null,
    settings: parseEditSettings(b.settings),
    hasSnapshot: b.settingsSnapshot != null,
    totalImages: b.totalImages,
    completedCount: b.completedCount,
    failedCount: b.failedCount,
    approvedCount: b.approvedCount,
    rejectedCount: b.rejectedCount,
    aiCallsUsed: b.aiCallsUsed,
    estimatedCostCents: b.estimatedCostCents,
    tags: parseJsonArray<string>(b.tags),
    startedAt: b.startedAt,
    finishedAt: b.finishedAt,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
    thumbnails: (b.images ?? []).slice(0, 4).map((i) => fileUrl(thumbKeyFor(i.editedKey ?? i.originalKey))),
  };
}
export type BatchDTO = ReturnType<typeof serializeBatch>;

/** Which page a batch opens to, by status. */
export function batchHref(b: { id: string; status: string; totalImages: number }): string {
  switch (b.status) {
    case "DRAFT":
      return b.totalImages > 0 ? `/batches/${b.id}/settings` : `/batches/${b.id}/upload`;
    case "READY":
      return `/batches/${b.id}/settings`;
    case "PROCESSING":
    case "PAUSED":
      return `/batches/${b.id}/processing`;
    default:
      return `/batches/${b.id}/review`;
  }
}

/** Recompute all counters from image rows (used after bulk changes). */
export async function recountBatch(batchId: string, tx: Pick<typeof prisma, "batchImage" | "batch"> = prisma) {
  const groups = await tx.batchImage.groupBy({ by: ["status"], where: { batchId }, _count: { _all: true } });
  const c = Object.fromEntries(groups.map((g) => [g.status, g._count._all])) as Record<string, number>;
  const total = groups.reduce((s, g) => s + g._count._all, 0);
  await tx.batch.update({
    where: { id: batchId },
    data: {
      totalImages: total,
      completedCount: (c.DONE ?? 0) + (c.APPROVED ?? 0) + (c.REJECTED ?? 0),
      failedCount: c.FAILED ?? 0,
      approvedCount: c.APPROVED ?? 0,
      rejectedCount: c.REJECTED ?? 0,
    },
  });
}
