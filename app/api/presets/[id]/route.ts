import { conflict, notFound, ok, parseBody, route } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { PresetUpdateSchema, serializePreset } from "@/lib/presets";

type Ctx = RouteContext<"/api/presets/[id]">;

export const GET = route(async (_req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const preset = await prisma.preset.findUnique({ where: { id } });
  if (!preset) throw notFound("Preset");
  return ok({ preset: serializePreset(preset) });
});

export const PATCH = route(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, PresetUpdateSchema);
  const existing = await prisma.preset.findUnique({ where: { id } });
  if (!existing) throw notFound("Preset");
  if (body.name && body.name !== existing.name && (await prisma.preset.findUnique({ where: { name: body.name } })))
    throw conflict("A preset with that name already exists");
  const preset = await prisma.preset.update({
    where: { id },
    data: {
      name: body.name,
      description: body.description,
      category: body.category,
      settings: body.settings,
    },
  });
  await logActivity("preset.updated", `Preset “${preset.name}” updated`);
  return ok({ preset: serializePreset(preset) });
});

export const DELETE = route(async (_req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const existing = await prisma.preset.findUnique({ where: { id } });
  if (!existing) throw notFound("Preset");
  await prisma.preset.delete({ where: { id } });
  await prisma.appSettings.updateMany({ where: { defaultPresetId: id }, data: { defaultPresetId: null } });
  await logActivity("preset.deleted", `Preset “${existing.name}” deleted`);
  return ok({ ok: true });
});
