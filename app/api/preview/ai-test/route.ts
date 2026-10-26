import { z } from "zod";
import { badRequest, IdParam, notFound, ok, parseBody, route } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { runAiStep } from "@/lib/pipeline";
import { getBackgroundRemovalProvider, getImageEditProvider, ProviderError, toProviderError } from "@/lib/providers";
import { getQcProvider } from "@/lib/qc";
import { EditSettingsSchema, imageNeedsAi } from "@/lib/settings";
import { storage } from "@/lib/storage";
import { ApiError } from "@/lib/api";

const Body = z.object({ imageId: IdParam, settings: EditSettingsSchema });

// Prevent double-charging from double clicks: one AI test per image at a time.
const inFlight = new Set<string>();

/**
 * Runs the full AI step on ONE image and caches the result on that image
 * (aiIntermediateKey + aiSettingsHash) so the batch run reuses it for free.
 */
export const POST = route(async (req) => {
  const { imageId, settings } = await parseBody(req, Body);
  const image = await prisma.batchImage.findUnique({ where: { id: imageId } });
  if (!image) throw notFound("Image");
  if (!imageNeedsAi(settings.ai, { useOriginal: false, perImageInstruction: image.perImageInstruction }))
    throw badRequest("No AI edits are enabled");
  if (inFlight.has(imageId)) throw new ApiError(409, "in_progress", "An AI test is already running for this image");
  inFlight.add(imageId);
  try {
    let recorded = false;
    const result = await runAiStep({ ...image, useOriginal: false, index: 1 }, settings, {
      storage: storage(),
      editProvider: getImageEditProvider,
      bgProvider: getBackgroundRemovalProvider,
      qcProvider: getQcProvider,
      onAiResult: async (r) => {
        recorded = true;
        await prisma.$transaction([
          prisma.batchImage.update({
            where: { id: imageId },
            data: { aiIntermediateKey: r.key, aiSettingsHash: r.hash },
          }),
          prisma.batch.update({ where: { id: image.batchId }, data: { aiCallsUsed: { increment: 1 } } }),
          prisma.usageEvent.create({
            data: { batchId: image.batchId, kind: r.route === "white-bg" ? "bg_removal" : "ai_edit" },
          }),
        ]);
      },
    });
    if (recorded) await logActivity("ai.test", `AI test on ${image.originalFilename}`, image.batchId);
    return ok({ cached: !result?.called, aiUrl: result ? `/api/files/${result.key}` : null });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    const perr = err instanceof ProviderError ? err : toProviderError(err);
    throw new ApiError(502, `provider_${perr.kind}`, perr.userMessage);
  } finally {
    inFlight.delete(imageId);
  }
});
