import { notFound, ok, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getAppSettings } from "@/lib/app-settings";

export const POST = route(async (_req, ctx: RouteContext<"/api/presets/[id]/default">) => {
  const { id } = await ctx.params;
  if (!(await prisma.preset.findUnique({ where: { id } }))) throw notFound("Preset");
  await getAppSettings();
  await prisma.$transaction([
    prisma.preset.updateMany({ where: { isDefault: true }, data: { isDefault: false } }),
    prisma.preset.update({ where: { id }, data: { isDefault: true } }),
    prisma.appSettings.update({ where: { id: "singleton" }, data: { defaultPresetId: id } }),
  ]);
  return ok({ ok: true });
});
