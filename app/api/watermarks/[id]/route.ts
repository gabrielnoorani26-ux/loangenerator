import { notFound, ok, route } from "@/lib/api";
import { getAppSettings, serializeAppSettings, type WatermarkEntry } from "@/lib/app-settings";
import { prisma } from "@/lib/db";
import { parseJsonArray } from "@/lib/json";
import { storage } from "@/lib/storage";

export const DELETE = route(async (_req, ctx: RouteContext<"/api/watermarks/[id]">) => {
  const { id } = await ctx.params;
  const app = await getAppSettings();
  const lib = parseJsonArray<WatermarkEntry>(app.watermarkLibrary);
  const entry = lib.find((w) => w.id === id);
  if (!entry) throw notFound("Watermark");
  const updated = await prisma.appSettings.update({
    where: { id: "singleton" },
    data: { watermarkLibrary: JSON.stringify(lib.filter((w) => w.id !== id)) },
  });
  await storage().delete(entry.key).catch(() => undefined);
  return ok({ settings: serializeAppSettings(updated) });
});
