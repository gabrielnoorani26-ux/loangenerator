import { z } from "zod";
import { IdList, notFound, ok, parseBody, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { estimateRun } from "@/lib/estimate";
import { EditSettingsSchema, parseEditSettings } from "@/lib/settings";

type Ctx = RouteContext<"/api/batches/[id]/estimate">;

async function estimateFor(batchId: string, settingsOverride?: unknown, ids?: string[], instruction?: string | null) {
  const batch = await prisma.batch.findUnique({ where: { id: batchId } });
  if (!batch) throw notFound("Batch");
  const settings = settingsOverride ? EditSettingsSchema.parse(settingsOverride) : parseEditSettings(batch.settingsSnapshot ?? batch.settings);
  const images = await prisma.batchImage.findMany({
    where: { batchId, ...(ids ? { id: { in: ids } } : {}) },
    select: { useOriginal: true, perImageInstruction: true, aiSettingsHash: true, aiIntermediateKey: true },
  });
  // A re-run with an instruction replaces each image's per-image instruction.
  const effective = instruction !== undefined ? images.map((i) => ({ ...i, perImageInstruction: instruction, useOriginal: false })) : images;
  return estimateRun(settings, effective);
}

/** Estimate for the batch's current (or frozen) settings. */
export const GET = route(async (_req, ctx: Ctx) => {
  const { id } = await ctx.params;
  return ok({ estimate: await estimateFor(id) });
});

const Body = z.object({
  settings: z.unknown().optional(),
  ids: IdList.optional(),
  /** For "re-run AI" estimates: the instruction that will be applied */
  instruction: z.string().max(500).nullable().optional(),
});

/** Estimate for draft settings and/or a subset of images. */
export const POST = route(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, Body);
  return ok({ estimate: await estimateFor(id, body.settings, body.ids, body.instruction) });
});
