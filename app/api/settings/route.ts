import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getAppSettings, serializeAppSettings, WatermarkEntrySchema } from "@/lib/app-settings";
import { logActivity } from "@/lib/activity";

const Patch = z.object({
  defaultPresetId: z.string().nullable().optional(),
  maxConcurrentAiCalls: z.number().int().min(1).max(5).optional(),
  maxRetries: z.number().int().min(0).max(5).optional(),
  autoQcEnabled: z.boolean().optional(),
  qcThreshold: z.number().int().min(0).max(100).optional(),
  brandList: z.array(z.string().trim().min(1).max(80)).min(1).max(50).optional(),
  defaultNamingPattern: z.string().trim().min(1).max(200).optional(),
  watermarkLibrary: z.array(WatermarkEntrySchema).max(50).optional(),
});

export const GET = route(async () => ok({ settings: serializeAppSettings(await getAppSettings()) }));

export const PATCH = route(async (req) => {
  const body = await parseBody(req, Patch);
  await getAppSettings();
  if (body.defaultPresetId !== undefined && body.defaultPresetId) {
    await prisma.$transaction([
      prisma.preset.updateMany({ where: { isDefault: true }, data: { isDefault: false } }),
      prisma.preset.update({ where: { id: body.defaultPresetId }, data: { isDefault: true } }),
    ]);
  }
  const updated = await prisma.appSettings.update({
    where: { id: "singleton" },
    data: {
      defaultPresetId: body.defaultPresetId,
      maxConcurrentAiCalls: body.maxConcurrentAiCalls,
      maxRetries: body.maxRetries,
      autoQcEnabled: body.autoQcEnabled,
      qcThreshold: body.qcThreshold,
      brandList: body.brandList ? JSON.stringify(body.brandList) : undefined,
      defaultNamingPattern: body.defaultNamingPattern,
      watermarkLibrary: body.watermarkLibrary ? JSON.stringify(body.watermarkLibrary) : undefined,
    },
  });
  await logActivity("settings.updated", Object.keys(body).join(", "));
  return ok({ settings: serializeAppSettings(updated) });
});
