import sharp from "sharp";
import { ApiError, ok, route } from "@/lib/api";
import { getAppSettings, serializeAppSettings, type WatermarkEntry } from "@/lib/app-settings";
import { prisma } from "@/lib/db";
import { createId } from "@/lib/ids";
import { sniffImageType } from "@/lib/mime";
import { keys, storage } from "@/lib/storage";
import { parseJsonArray } from "@/lib/json";

/** Upload a PNG logo to the watermark library. */
export const POST = route(async (req) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "no_file", "Choose a PNG file to upload");
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > 5 * 1024 * 1024) throw new ApiError(400, "too_large", "Logo must be under 5 MB");
  if (sniffImageType(buf) !== "png")
    throw new ApiError(400, "invalid_type", "Logos must be PNG files (transparency recommended)");
  const id = createId();
  const key = keys.watermark(id);
  // Normalize (and cap size) so composites stay fast.
  await storage().put(
    key,
    await sharp(buf).resize(2000, 2000, { fit: "inside", withoutEnlargement: true }).png().toBuffer(),
  );
  const app = await getAppSettings();
  const name = String(form?.get("name") || file.name.replace(/\.png$/i, "")).slice(0, 60) || "Logo";
  const lib = [...parseJsonArray<WatermarkEntry>(app.watermarkLibrary), { id, name, key }];
  const updated = await prisma.appSettings.update({
    where: { id: "singleton" },
    data: { watermarkLibrary: JSON.stringify(lib) },
  });
  return ok({ settings: serializeAppSettings(updated) }, { status: 201 });
});
