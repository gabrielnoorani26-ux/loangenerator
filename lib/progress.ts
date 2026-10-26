import { prisma } from "./db";
import { fileUrl, thumbKeyFor } from "./storage";

/** Live progress snapshot for the processing page. */
export async function getProgress(batchId: string, now = new Date()) {
  const batch = await prisma.batch.findUnique({ where: { id: batchId } });
  if (!batch) return null;
  const images = await prisma.batchImage.findMany({
    where: { batchId },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      status: true,
      originalFilename: true,
      originalKey: true,
      editedKey: true,
      errorMessage: true,
      retryCount: true,
      availableAt: true,
      qcScore: true,
      qcVerdict: true,
    },
  });
  const counts: Record<string, number> = { QUEUED: 0, PROCESSING_AI: 0, PROCESSING_STANDARD: 0, DONE: 0, FAILED: 0, APPROVED: 0, REJECTED: 0 };
  for (const i of images) counts[i.status] = (counts[i.status] ?? 0) + 1;
  const finished = counts.DONE + counts.APPROVED + counts.REJECTED + counts.FAILED;
  const remaining = counts.QUEUED + counts.PROCESSING_AI + counts.PROCESSING_STANDARD;
  const end = batch.finishedAt && remaining === 0 ? batch.finishedAt : now;
  const elapsedSeconds = batch.startedAt ? Math.max(0, (end.getTime() - batch.startedAt.getTime()) / 1000) : 0;
  // Throughput-based average (already reflects concurrency).
  const avgSecondsPerImage = finished > 0 && elapsedSeconds > 0 ? elapsedSeconds / finished : null;
  const etaSeconds = avgSecondsPerImage != null && remaining > 0 ? avgSecondsPerImage * remaining : remaining === 0 ? 0 : null;
  return {
    batchId,
    status: batch.status,
    total: images.length,
    counts,
    finished,
    remaining,
    percent: images.length ? Math.round((finished / images.length) * 100) : 0,
    aiCallsUsed: batch.aiCallsUsed,
    startedAt: batch.startedAt,
    finishedAt: batch.finishedAt,
    elapsedSeconds,
    avgSecondsPerImage,
    etaSeconds,
    images: images.map((i) => ({
      id: i.id,
      status: i.status,
      filename: i.originalFilename,
      thumbUrl: fileUrl(thumbKeyFor(i.editedKey ?? i.originalKey)),
      errorMessage: i.errorMessage,
      retrying: i.status === "QUEUED" && i.retryCount > 0,
      qcScore: i.qcScore,
      needsReview: i.status === "DONE" && i.qcVerdict === "review",
    })),
  };
}
export type Progress = NonNullable<Awaited<ReturnType<typeof getProgress>>>;
