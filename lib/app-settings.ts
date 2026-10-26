import { z } from "zod";
import { prisma } from "./db";
import { env } from "./env";
import { parseJsonArray } from "./json";

export const WatermarkEntrySchema = z.object({ id: z.string(), name: z.string(), key: z.string() });
export type WatermarkEntry = z.infer<typeof WatermarkEntrySchema>;

export async function getAppSettings() {
  const existing = await prisma.appSettings.findUnique({ where: { id: "singleton" } });
  if (existing) return existing;
  return prisma.appSettings.create({
    data: { id: "singleton", maxConcurrentAiCalls: env.maxConcurrentAiCalls, maxRetries: env.maxRetries },
  });
}

export function serializeAppSettings(s: Awaited<ReturnType<typeof getAppSettings>>) {
  return {
    ...s,
    brandList: parseJsonArray<string>(s.brandList),
    watermarkLibrary: parseJsonArray<WatermarkEntry>(s.watermarkLibrary),
  };
}
export type AppSettingsDTO = ReturnType<typeof serializeAppSettings>;
