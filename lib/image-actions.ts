/** Review actions on images (single + bulk). Route handlers stay thin. */
import { prisma } from "./db";
import { conflict, notFound } from "./api";
import { logActivity } from "./activity";
import { recountBatch } from "./batches";
import { deleteWithThumb } from "./files";
import { requeueImages } from "./queue";

const REVIEWABLE = ["DONE", "APPROVED", "REJECTED"] as const;

export async function setReviewStatus(batchId: string, ids: string[], status: "APPROVED" | "REJECTED"): Promise<number> {
  const n = await prisma.$transaction(async (tx) => {
    const r = await tx.batchImage.updateMany({ where: { batchId, id: { in: ids }, status: { in: [...REVIEWABLE] } }, data: { status } });
    await recountBatch(batchId, tx);
    return r.count;
  });
  if (ids.length > 1) await logActivity(status === "APPROVED" ? "images.approved" : "images.rejected", `${n} image(s)`, batchId);
  return n;
}

export async function rerunAi(batchId: string, ids: string[], instruction?: string | null) {
  // An explicit AI re-run always produces a fresh AI result.
  const n = await requeueImages(batchId, ids, { kind: "FULL", instruction, forceAi: true, useOriginal: false });
  await logActivity("images.rerun_ai", `${n} image(s)${instruction ? ` · “${instruction.slice(0, 80)}”` : ""}`, batchId);
  return n;
}

export async function reapplyStandard(batchId: string, ids: string[]) {
  const n = await requeueImages(batchId, ids, { kind: "STANDARD" });
  await logActivity("images.reapply_standard", `${n} image(s) · no AI cost`, batchId);
  return n;
}

export async function useOriginal(batchId: string, ids: string[], value: boolean) {
  // Standard-only job: the output is rebuilt from the original (or cached AI result) at zero AI cost.
  const n = await requeueImages(batchId, ids, { kind: "STANDARD", useOriginal: value });
  await logActivity("images.use_original", `${n} image(s) ${value ? "now use the original" : "use the AI result again"}`, batchId);
  return n;
}

export async function retryFailed(batchId: string) {
  const failed = await prisma.batchImage.findMany({ where: { batchId, status: "FAILED" }, select: { id: true } });
  if (!failed.length) return 0;
  const n = await requeueImages(batchId, failed.map((f) => f.id), { kind: "FULL" });
  await logActivity("images.retry_failed", `${n} image(s)`, batchId);
  return n;
}

export async function deleteImages(batchId: string, ids: string[]) {
  const images = await prisma.batchImage.findMany({
    where: { batchId, id: { in: ids }, status: { notIn: ["PROCESSING_AI", "PROCESSING_STANDARD"] } },
    include: { versions: true },
  });
  await prisma.$transaction(async (tx) => {
    await tx.batchImage.deleteMany({ where: { id: { in: images.map((i) => i.id) } } });
    await recountBatch(batchId, tx);
  });
  for (const image of images) {
    await Promise.all([
      deleteWithThumb(image.originalKey),
      deleteWithThumb(image.aiIntermediateKey),
      deleteWithThumb(image.editedKey),
      ...image.versions.map((v) => Promise.all([deleteWithThumb(v.editedKey), deleteWithThumb(v.aiIntermediateKey)])),
    ]);
  }
  await logActivity("images.deleted", `${images.length} image(s)`, batchId);
  return images.length;
}

/** Swap the current output with a saved version. The current output becomes a version itself. */
export async function revertToVersion(imageId: string, versionId: string) {
  return prisma.$transaction(async (tx) => {
    const image = await tx.batchImage.findUnique({ where: { id: imageId } });
    const version = await tx.imageVersion.findUnique({ where: { id: versionId } });
    if (!image || !version || version.imageId !== imageId) throw notFound("Version");
    if (image.status === "PROCESSING_AI" || image.status === "PROCESSING_STANDARD" || image.status === "QUEUED")
      throw conflict("Wait for the image to finish processing");
    if (image.editedKey) {
      await tx.imageVersion.create({
        data: {
          imageId,
          aiIntermediateKey: image.aiIntermediateKey,
          aiSettingsHash: image.aiSettingsHash,
          editedKey: image.editedKey,
          outputWidth: image.outputWidth,
          outputHeight: image.outputHeight,
          outputSizeKb: image.outputSizeKb,
          instruction: image.perImageInstruction,
          qcScore: image.qcScore,
        },
      });
    }
    await tx.imageVersion.delete({ where: { id: versionId } });
    const ext = version.editedKey.split(".").pop();
    const base = image.outputFilename?.replace(/\.[A-Za-z0-9]+$/, "");
    const updated = await tx.batchImage.update({
      where: { id: imageId },
      data: {
        editedKey: version.editedKey,
        aiIntermediateKey: version.aiIntermediateKey ?? image.aiIntermediateKey,
        aiSettingsHash: version.aiIntermediateKey ? version.aiSettingsHash : image.aiSettingsHash,
        outputWidth: version.outputWidth,
        outputHeight: version.outputHeight,
        outputSizeKb: version.outputSizeKb,
        outputFilename: base && ext ? `${base}.${ext}` : image.outputFilename,
        qcScore: version.qcScore,
        status: "DONE",
      },
    });
    await recountBatch(image.batchId, tx);
    return updated;
  });
}
