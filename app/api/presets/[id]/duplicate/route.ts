import { notFound, ok, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { serializePreset, uniquePresetName } from "@/lib/presets";
import { parseEditSettings } from "@/lib/settings";

export const POST = route(async (_req, ctx: RouteContext<"/api/presets/[id]/duplicate">) => {
  const { id } = await ctx.params;
  const src = await prisma.preset.findUnique({ where: { id } });
  if (!src) throw notFound("Preset");
  const preset = await prisma.preset.create({
    data: {
      name: await uniquePresetName(`${src.name} copy`),
      description: src.description,
      category: src.category,
      settings: parseEditSettings(src.settings),
    },
  });
  return ok({ preset: serializePreset(preset) }, { status: 201 });
});
