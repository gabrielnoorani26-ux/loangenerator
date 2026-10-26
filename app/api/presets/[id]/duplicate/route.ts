import { notFound, ok, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { serializePreset, uniquePresetName } from "@/lib/presets";
import { parseEditSettings } from "@/lib/settings";
import { generatePresetExample } from "@/lib/preset-example";

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
  await generatePresetExample(preset);
  return ok(
    { preset: serializePreset((await prisma.preset.findUnique({ where: { id: preset.id } }))!) },
    { status: 201 },
  );
});
