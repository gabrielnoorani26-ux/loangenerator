import { z } from "zod";
import { prisma, type Preset } from "./db";
import { EditSettingsSchema, parseEditSettings } from "./settings";
import { summarizeSettings } from "./summary";
import { fileUrl } from "./storage";

export const PresetCategorySchema = z.enum(["ECOMMERCE", "WHOLESALE", "SOCIAL", "WEB", "CUSTOM"]);

export const PresetCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(300).optional().nullable(),
  category: PresetCategorySchema.default("CUSTOM"),
  settings: EditSettingsSchema,
});
export const PresetUpdateSchema = PresetCreateSchema.partial();

export function serializePreset(p: Preset) {
  const settings = parseEditSettings(p.settings);
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    category: p.category,
    settings,
    summary: summarizeSettings(settings),
    isDefault: p.isDefault,
    usageCount: p.usageCount,
    exampleUrl: fileUrl(p.exampleKey),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}
export type PresetDTO = ReturnType<typeof serializePreset>;

export async function uniquePresetName(base: string): Promise<string> {
  let name = base;
  let i = 2;
  while (await prisma.preset.findUnique({ where: { name } })) name = `${base} (${i++})`;
  return name;
}
