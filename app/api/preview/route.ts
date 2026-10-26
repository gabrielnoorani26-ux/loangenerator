import { z } from "zod";
import sharp from "sharp";
import { IdParam, notFound, parseBody, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { EditSettingsSchema } from "@/lib/settings";
import { applyStandardEdits, scaleStandardForPreview } from "@/lib/standard-edits";
import { storage } from "@/lib/storage";
import { loadWatermarkAssets } from "@/lib/watermarks";
import { CONTENT_TYPES } from "@/lib/mime";
import { aiSettingsHash } from "@/lib/ai-hash";
import { getSampleImage } from "@/lib/sample-image";

const Body = z.object({
  /** Omit to preview on the built-in sample image (Presets page) */
  imageId: IdParam.optional(),
  settings: EditSettingsSchema,
  /** "auto": use the cached AI result when there is one; "original": always the original */
  source: z.enum(["auto", "original"]).default("auto"),
});

const PREVIEW_MAX = 1200;

/** Standard edits only (zero AI cost), rendered at ≤1200px. */
export const POST = route(async (req) => {
  const { imageId, settings, source } = await parseBody(req, Body);
  let input: Buffer;
  let useAi = false;
  if (imageId) {
    const image = await prisma.batchImage.findUnique({ where: { id: imageId } });
    if (!image) throw notFound("Image");
    // Only show the cached AI result when it was produced by the current AI settings.
    const hash = aiSettingsHash(settings.ai, image.perImageInstruction);
    useAi = Boolean(
      source === "auto" && !image.useOriginal && image.aiIntermediateKey && hash && image.aiSettingsHash === hash,
    );
    input = await storage().get(useAi ? image.aiIntermediateKey! : image.originalKey);
  } else {
    input = await getSampleImage();
  }
  const assets = await loadWatermarkAssets(settings.standard.watermark);
  // Render at reduced geometry for speed; relative settings keep it visually identical to the real output.
  const { standard, scale } = scaleStandardForPreview(settings.standard, PREVIEW_MAX);
  const full = await applyStandardEdits(input, standard, settings.output, { maxInputSide: 2000, assets, fast: true });
  const outW = Math.round(full.width / scale);
  const outH = Math.round(full.height / scale);
  let data = full.data;
  if (Math.max(full.width, full.height) > PREVIEW_MAX) {
    const s = sharp(data).resize(PREVIEW_MAX, PREVIEW_MAX, { fit: "inside" });
    data = await (
      settings.output.format === "jpg"
        ? s.jpeg({ quality: 88 })
        : settings.output.format === "webp"
          ? s.webp({ quality: 88 })
          : s.png()
    ).toBuffer();
  }
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": CONTENT_TYPES[settings.output.format],
      "Cache-Control": "no-store",
      "X-Output-Width": String(outW),
      "X-Output-Height": String(outH),
      "X-Used-Ai": useAi ? "1" : "0",
    },
  });
});
