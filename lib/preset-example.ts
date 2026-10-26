import sharp from "sharp";
import { prisma, type Preset } from "./db";
import { getSampleImage } from "./sample-image";
import { parseEditSettings } from "./settings";
import { applyStandardEdits, scaleStandardForPreview } from "./standard-edits";
import { keys, storage } from "./storage";
import { loadWatermarkAssets } from "./watermarks";

/** Render the preset's standard edits on the sample image (AI edits are not simulated). */
export async function generatePresetExample(preset: Preset): Promise<string | null> {
  try {
    const settings = parseEditSettings(preset.settings);
    const { standard } = scaleStandardForPreview(settings.standard, 600);
    const out = await applyStandardEdits(await getSampleImage(), standard, settings.output, {
      maxInputSide: 1200,
      assets: await loadWatermarkAssets(settings.standard.watermark),
    });
    const thumb = await sharp(out.data).resize(480, 480, { fit: "inside" }).webp({ quality: 80 }).toBuffer();
    const key = keys.presetExample(`${preset.id}-${Date.now()}`);
    await storage().put(key, thumb);
    if (preset.exampleKey) await storage().delete(preset.exampleKey).catch(() => undefined);
    await prisma.preset.update({ where: { id: preset.id }, data: { exampleKey: key } });
    return key;
  } catch (err) {
    console.error("[presets] example generation failed", err);
    return null;
  }
}
