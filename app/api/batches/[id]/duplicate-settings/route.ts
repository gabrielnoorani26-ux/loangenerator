import { notFound, ok, route } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { serializeBatch } from "@/lib/batches";
import { parseEditSettings } from "@/lib/settings";

/** New empty DRAFT batch with the same settings, preset, brand and tags. */
export const POST = route(async (_req, ctx: RouteContext<"/api/batches/[id]/duplicate-settings">) => {
  const { id } = await ctx.params;
  const src = await prisma.batch.findUnique({ where: { id } });
  if (!src) throw notFound("Batch");
  const batch = await prisma.batch.create({
    data: {
      name: `${src.name} (copy)`.slice(0, 120),
      brand: src.brand,
      description: src.description,
      tags: src.tags,
      presetId: src.presetId,
      settings: parseEditSettings(src.settingsSnapshot ?? src.settings),
    },
  });
  await logActivity("batch.created", `Duplicated settings from “${src.name}”`, batch.id);
  return ok({ batch: serializeBatch(batch) }, { status: 201 });
});
