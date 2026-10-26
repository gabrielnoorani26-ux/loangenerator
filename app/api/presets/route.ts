import { conflict, ok, parseBody, route } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { PresetCreateSchema, serializePreset } from "@/lib/presets";

export const GET = route(async () => {
  const presets = await prisma.preset.findMany({ orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
  return ok({ presets: presets.map(serializePreset) });
});

export const POST = route(async (req) => {
  const body = await parseBody(req, PresetCreateSchema);
  if (await prisma.preset.findUnique({ where: { name: body.name } })) throw conflict("A preset with that name already exists");
  const preset = await prisma.preset.create({
    data: { name: body.name, description: body.description ?? null, category: body.category, settings: body.settings },
  });
  await logActivity("preset.created", `Preset “${preset.name}” created`);
  return ok({ preset: serializePreset(preset) }, { status: 201 });
});
