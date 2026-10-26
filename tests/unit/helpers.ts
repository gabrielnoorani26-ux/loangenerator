import sharp from "sharp";
import { prisma } from "@/lib/db";
import { keys, storage, thumbKeyFor } from "@/lib/storage";
import { EditSettingsSchema, type EditSettingsInput } from "@/lib/settings";
import { createId } from "@/lib/ids";

export async function productPng(color = "#aa3322", w = 300, h = 200): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#eeeeee"/><rect x="${w / 4}" y="${h / 4}" width="${w / 2}" height="${h / 2}" fill="${color}"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function makeBatch(n: number, settings: EditSettingsInput = {}, name = "Test batch") {
  const batch = await prisma.batch.create({
    data: { name, brand: "Chelsea Crew", settings: EditSettingsSchema.parse(settings), totalImages: n },
  });
  const png = await productPng();
  for (let i = 0; i < n; i++) {
    const id = createId();
    const key = keys.original(batch.id, id, "png");
    await storage().put(key, png);
    await storage().put(thumbKeyFor(key), png);
    await prisma.batchImage.create({
      data: {
        id,
        batchId: batch.id,
        sortOrder: i,
        originalKey: key,
        originalFilename: `CC${1000 + i}_black_side.png`,
        originalWidth: 300,
        originalHeight: 200,
        originalSizeKb: 1,
        originalMime: "image/png",
        styleCode: `CC${1000 + i}`,
        colorName: "black",
        viewAngle: "SIDE",
      },
    });
  }
  return batch;
}

export const AI_SETTINGS: EditSettingsInput = {
  ai: { background: { mode: "solid" }, shadow: "soft" },
  standard: { fit: { enabled: true, width: 400, height: 400 } },
  output: { format: "jpg", namingPattern: "{color}_{view}" },
};
