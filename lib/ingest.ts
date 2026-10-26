/**
 * Upload ingestion: validate by file signature, convert HEIC → JPG, read
 * oriented dimensions, and build a thumbnail. Pure w.r.t. storage — callers
 * persist the returned buffers.
 */
import sharp, { type Metadata } from "sharp";
import { sniffImageType } from "./mime";

export class UploadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UploadValidationError";
  }
}

export interface IngestedImage {
  data: Buffer;
  ext: "jpg" | "png" | "webp";
  mime: string;
  width: number;
  height: number;
  sizeKb: number;
  convertedFromHeic: boolean;
}

const MIME = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" } as const;

export async function ingestImage(input: Buffer, filename: string, maxBytes: number): Promise<IngestedImage> {
  if (input.length === 0) throw new UploadValidationError(`${filename}: file is empty`);
  if (input.length > maxBytes)
    throw new UploadValidationError(
      `${filename}: file is ${(input.length / 1024 / 1024).toFixed(1)} MB — the limit is ${Math.round(maxBytes / 1024 / 1024)} MB`,
    );
  const type = sniffImageType(input);
  if (!type) throw new UploadValidationError(`${filename}: unsupported file type — use JPG, PNG, WEBP or HEIC`);

  let data = input;
  let ext: IngestedImage["ext"];
  let convertedFromHeic = false;
  if (type === "heic") {
    try {
      const { default: convert } = await import("heic-convert");
      data = Buffer.from(await convert({ buffer: new Uint8Array(input), format: "JPEG", quality: 0.95 }));
    } catch {
      throw new UploadValidationError(`${filename}: could not convert HEIC image`);
    }
    ext = "jpg";
    convertedFromHeic = true;
  } else {
    ext = type;
  }

  let meta: Metadata;
  try {
    meta = await sharp(data).metadata();
  } catch {
    throw new UploadValidationError(`${filename}: image is corrupt or unreadable`);
  }
  if (!meta.width || !meta.height) throw new UploadValidationError(`${filename}: could not read image dimensions`);
  // EXIF orientations 5–8 swap width/height when displayed.
  const swap = (meta.orientation ?? 1) >= 5;
  return {
    data,
    ext,
    mime: MIME[ext],
    width: swap ? meta.height : meta.width,
    height: swap ? meta.width : meta.height,
    sizeKb: Math.max(1, Math.round(data.length / 1024)),
    convertedFromHeic,
  };
}

/** 480px WebP thumbnail, EXIF-oriented, transparency preserved. */
export async function makeThumbnail(data: Buffer): Promise<Buffer> {
  return sharp(data)
    .rotate()
    .resize(480, 480, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer();
}
