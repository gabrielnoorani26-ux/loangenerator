/**
 * Deterministic "standard" edits with sharp. Pure: Buffer in → Buffer out.
 *
 * Order (spec §4): auto-trim → crop to aspect → fit to canvas/padding → resize
 * → adjustments → watermark → flatten (JPG) → export → enforce max KB → metadata.
 *
 * Every step materializes to a raw RGBA buffer so the order above is exactly
 * the order applied (a single sharp pipeline reorders some operations).
 */
import sharp, { type Metadata, type Sharp } from "sharp";
import type { AspectRatio, OutputSettings, StandardSettings, WatermarkPosition } from "./settings";

export interface RawImage {
  data: Buffer;
  width: number;
  height: number;
}

export interface WatermarkAssets {
  /** PNG buffer for logo watermarks, already loaded from storage */
  logo?: Buffer | null;
}

export interface StandardEditResult {
  data: Buffer;
  width: number;
  height: number;
  sizeKb: number;
  format: OutputSettings["format"];
  quality: number;
  /** false when maxKb could not be reached even at the quality floor */
  maxKbMet: boolean;
}

const CHANNELS = 4;

async function toRaw(img: Sharp): Promise<RawImage> {
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function fromRaw(img: RawImage): Sharp {
  return sharp(img.data, { raw: { width: img.width, height: img.height, channels: CHANNELS } });
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Decode any supported input, apply EXIF orientation, return RGBA raw. */
export async function decode(input: Buffer, maxLongestSide?: number): Promise<RawImage> {
  let img = sharp(input, { failOn: "error" }).rotate();
  if (maxLongestSide) img = img.resize(maxLongestSide, maxLongestSide, { fit: "inside", withoutEnlargement: true });
  return toRaw(img);
}

// ---------------------------------------------------------------- auto-trim

/**
 * Trim near-uniform borders. Slider 0..100 maps directly to sharp's trim
 * `threshold` (allowed color distance from the top-left pixel; sharp's default
 * is 10). Higher = more aggressive. If the whole image is uniform, it is left
 * untouched rather than trimmed to nothing.
 */
export async function autoTrim(img: RawImage, threshold: number): Promise<RawImage> {
  try {
    const out = await toRaw(fromRaw(img).trim({ threshold: Math.max(1, threshold) }));
    if (out.width < 2 || out.height < 2) return img;
    return out;
  } catch {
    return img;
  }
}

// ---------------------------------------------------------------- crop

export function aspectValue(aspect: AspectRatio, customW: number, customH: number): number | null {
  if (aspect === "original") return null;
  if (aspect === "custom") return customW / customH;
  const [w, h] = aspect.split(":").map(Number);
  return w / h;
}

/** Compute the crop rectangle for a target aspect ratio. Exported for tests. */
export function cropRect(
  width: number,
  height: number,
  ratio: number,
  anchor: "center" | "top" | "bottom",
): { left: number; top: number; width: number; height: number } {
  const current = width / height;
  if (Math.abs(current - ratio) < 1e-3) return { left: 0, top: 0, width, height };
  if (current > ratio) {
    // too wide → crop width, always centered horizontally
    const w = Math.max(1, Math.round(height * ratio));
    return { left: Math.floor((width - w) / 2), top: 0, width: w, height };
  }
  const h = Math.max(1, Math.round(width / ratio));
  const top = anchor === "top" ? 0 : anchor === "bottom" ? height - h : Math.floor((height - h) / 2);
  return { left: 0, top, width, height: h };
}

export async function cropToAspect(img: RawImage, crop: StandardSettings["crop"]): Promise<RawImage> {
  const ratio = aspectValue(crop.aspect, crop.customWidth, crop.customHeight);
  if (!ratio) return img;
  const rect = cropRect(img.width, img.height, ratio, crop.anchor);
  if (rect.width === img.width && rect.height === img.height) return img;
  return toRaw(fromRaw(img).extract(rect));
}

// ---------------------------------------------------------------- fit to canvas

/**
 * Place the image, scaled to fit fully inside the canvas minus padding, on a
 * WxH canvas filled with `fillColor`. Padding is a percentage of each canvas
 * dimension applied on every side (10% → product occupies at most 80%).
 */
export async function fitToCanvas(img: RawImage, fit: StandardSettings["fit"]): Promise<RawImage> {
  const pad = fit.paddingPct / 100;
  const innerW = Math.max(1, Math.round(fit.width * (1 - 2 * pad)));
  const innerH = Math.max(1, Math.round(fit.height * (1 - 2 * pad)));
  const scaled = await fromRaw(img)
    .resize(innerW, innerH, { fit: "inside", kernel: "lanczos3" })
    .png()
    .toBuffer({ resolveWithObject: true });
  const { r, g, b } = hexToRgb(fit.fillColor);
  const left = Math.round((fit.width - scaled.info.width) / 2);
  const top = Math.round((fit.height - scaled.info.height) / 2);
  return toRaw(
    sharp({ create: { width: fit.width, height: fit.height, channels: 4, background: { r, g, b, alpha: 1 } } }).composite([
      { input: scaled.data, left, top },
    ]),
  );
}

// ---------------------------------------------------------------- resize

/**
 * Resize modes:
 *  - exact: lockAspect → cover (exact WxH, excess cropped, no distortion); unlocked → stretch to WxH
 *  - longest / shortest: that side becomes `value` px, other side proportional
 *  - percentage: scale both sides by value%
 */
export function resizeDims(
  width: number,
  height: number,
  r: StandardSettings["resize"],
): { width: number; height: number; fit: "cover" | "fill" } {
  switch (r.mode) {
    case "exact":
      return { width: r.width, height: r.height, fit: r.lockAspect ? "cover" : "fill" };
    case "longest": {
      const s = r.value / Math.max(width, height);
      return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)), fit: "fill" };
    }
    case "shortest": {
      const s = r.value / Math.min(width, height);
      return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)), fit: "fill" };
    }
    case "percentage": {
      const s = Math.min(r.value, 400) / 100;
      return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)), fit: "fill" };
    }
  }
}

export async function resize(img: RawImage, r: StandardSettings["resize"]): Promise<RawImage> {
  const d = resizeDims(img.width, img.height, r);
  if (d.width === img.width && d.height === img.height) return img;
  return toRaw(fromRaw(img).resize(d.width, d.height, { fit: d.fit, kernel: "lanczos3" }));
}

// ---------------------------------------------------------------- adjustments

/**
 * Slider (−100..+100) → sharp mapping. Alpha is split off first and re-joined
 * so adjustments never touch transparency.
 *  - brightness b: modulate({ brightness: 1 + b/200 })        → 0.5× .. 1.5×
 *  - saturation s: modulate({ saturation: 1 + s/100 })        → 0 (gray) .. 2×
 *  - contrast   c: linear(a, 128·(1−a)), a = 1 + c/150         → 0.33 .. 1.67 slope pivoting on mid-gray
 *  - warmth     w: linear([1+k, 1, 1−k]), k = w/400            → ±25% red/blue balance shift
 *  - sharpness  s: s>0 → sharpen({ sigma: 0.5 + 1.5·s/100 }); s<0 → blur(0.3 + 2·|s|/100)
 */
export function adjustmentParams(a: StandardSettings["adjustments"]) {
  const contrastSlope = 1 + a.contrast / 150;
  const k = a.warmth / 400;
  return {
    brightness: 1 + a.brightness / 200,
    saturation: 1 + a.saturation / 100,
    contrast: { a: contrastSlope, b: 128 * (1 - contrastSlope) },
    warmth: { a: [1 + k, 1, 1 - k], b: [0, 0, 0] },
    sharpenSigma: a.sharpness > 0 ? 0.5 + (1.5 * a.sharpness) / 100 : null,
    blurSigma: a.sharpness < 0 ? 0.3 + (2 * Math.abs(a.sharpness)) / 100 : null,
  };
}

export async function applyAdjustments(img: RawImage, a: StandardSettings["adjustments"]): Promise<RawImage> {
  if (Object.values(a).every((v) => v === 0)) return img;
  const p = adjustmentParams(a);
  const alpha = await fromRaw(img).extractChannel(3).raw().toBuffer();
  const rgb = await fromRaw(img).removeAlpha().raw().toBuffer();
  const meta = { raw: { width: img.width, height: img.height, channels: 3 as const } };

  let buf = rgb;
  const step = async (fn: (s: Sharp) => Sharp) => {
    buf = await fn(sharp(buf, meta)).raw().toBuffer();
  };
  if (a.brightness !== 0 || a.saturation !== 0)
    await step((s) => s.modulate({ brightness: p.brightness, saturation: p.saturation }));
  if (a.contrast !== 0) await step((s) => s.linear(p.contrast.a, p.contrast.b));
  if (a.warmth !== 0) await step((s) => s.linear(p.warmth.a, p.warmth.b));
  if (p.sharpenSigma) await step((s) => s.sharpen({ sigma: p.sharpenSigma! }));
  if (p.blurSigma) await step((s) => s.blur(p.blurSigma!));

  const joined = await sharp(buf, meta)
    .joinChannel(alpha, { raw: { width: img.width, height: img.height, channels: 1 } })
    .raw()
    .toBuffer();
  return { data: joined, width: img.width, height: img.height };
}

// ---------------------------------------------------------------- watermark

export function watermarkPosition(
  pos: WatermarkPosition,
  canvasW: number,
  canvasH: number,
  wmW: number,
  wmH: number,
  margin: number,
): { left: number; top: number } {
  const [v, h] = pos === "center" ? ["middle", "center"] : pos.split("-");
  const left = h === "left" ? margin : h === "right" ? canvasW - wmW - margin : Math.round((canvasW - wmW) / 2);
  const top = v === "top" ? margin : v === "bottom" ? canvasH - wmH - margin : Math.round((canvasH - wmH) / 2);
  return {
    left: Math.max(0, Math.min(canvasW - wmW, left)),
    top: Math.max(0, Math.min(canvasH - wmH, top)),
  };
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}

async function scaleAlpha(png: Buffer, opacity: number): Promise<Buffer> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < data.length; i += 4) data[i] = Math.round(data[i] * opacity);
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

export async function applyWatermark(
  img: RawImage,
  wm: StandardSettings["watermark"],
  assets: WatermarkAssets,
): Promise<RawImage> {
  if (!wm.enabled) return img;
  const targetW = Math.max(8, Math.round((img.width * wm.sizePct) / 100));
  const opacity = wm.opacity / 100;
  let overlay: Buffer | null = null;

  if (wm.type === "logo") {
    if (!assets.logo) return img;
    const resized = await sharp(assets.logo).resize({ width: targetW, height: img.height, fit: "inside" }).png().toBuffer();
    overlay = await scaleAlpha(resized, opacity);
  } else {
    const text = wm.text.trim();
    if (!text) return img;
    // Font size chosen so the text spans roughly targetW (avg glyph ≈ 0.6em).
    const fontSize = Math.max(8, Math.round(targetW / Math.max(1, text.length * 0.6)));
    const w = Math.min(img.width, Math.round(fontSize * text.length * 0.62) + 8);
    const h = Math.round(fontSize * 1.3);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" font-family="Inter, DejaVu Sans, sans-serif"
        font-weight="600" font-size="${fontSize}" fill="#FFFFFF" fill-opacity="${opacity}" stroke="#000000" stroke-opacity="${opacity * 0.35}" stroke-width="${Math.max(1, fontSize / 28)}">${escapeXml(text)}</text>
    </svg>`;
    overlay = await sharp(Buffer.from(svg)).png().toBuffer();
  }
  const meta = await sharp(overlay).metadata();
  const ow = Math.min(meta.width ?? 0, img.width);
  const oh = Math.min(meta.height ?? 0, img.height);
  if (!ow || !oh) return img;
  if (ow !== meta.width || oh !== meta.height) overlay = await sharp(overlay).resize(ow, oh, { fit: "inside" }).png().toBuffer();
  const margin = Math.round((Math.min(img.width, img.height) * wm.marginPct) / 100);
  const { left, top } = watermarkPosition(wm.position, img.width, img.height, ow, oh, margin);
  return toRaw(fromRaw(img).composite([{ input: overlay, left, top }]));
}

// ---------------------------------------------------------------- export

export interface SourceMetadata {
  exif?: Record<string, string>;
}

/** Read a small, safe subset of EXIF from the source to carry over when metadata is kept. */
export async function readKeepableMetadata(source: Buffer): Promise<SourceMetadata> {
  try {
    const { default: exifr } = await import("exifr");
    const tags = (await exifr.parse(source, {
      pick: ["Artist", "Copyright", "ImageDescription", "Make", "Model", "DateTimeOriginal"],
    })) as Record<string, unknown> | undefined;
    if (!tags) return {};
    const exif: Record<string, string> = {};
    for (const [k, v] of Object.entries(tags)) {
      if (v == null) continue;
      exif[k] = v instanceof Date ? v.toISOString().replace("T", " ").slice(0, 19).replace(/-/g, ":") : String(v);
    }
    return { exif };
  } catch {
    return {};
  }
}

async function encode(
  img: RawImage,
  out: OutputSettings,
  quality: number,
  meta: SourceMetadata,
  palette: boolean,
): Promise<Buffer> {
  let s = fromRaw(img);
  if (out.format === "jpg") {
    // JPG has no alpha: flatten transparency onto the configured color.
    const { r, g, b } = hexToRgb(out.flattenColor);
    s = s.flatten({ background: { r, g, b } }).jpeg({ quality, mozjpeg: true, chromaSubsampling: quality >= 90 ? "4:4:4" : "4:2:0" });
  } else if (out.format === "webp") {
    s = s.webp({ quality, alphaQuality: 100, effort: 4 });
  } else {
    s = s.png(palette ? { palette: true, quality, compressionLevel: 9, effort: 7 } : { compressionLevel: 9, adaptiveFiltering: true });
  }
  // sharp strips all metadata by default. When the user turns stripping off we
  // keep an sRGB profile plus descriptive EXIF fields from the source.
  if (!out.stripMetadata) {
    s = s.withIccProfile("srgb");
    const ifd0: Record<string, string> = { Software: "BatchLens" };
    for (const [k, v] of Object.entries(meta.exif ?? {})) if (k !== "DateTimeOriginal") ifd0[k] = v;
    s = s.withExif({ IFD0: ifd0 });
  }
  return s.toBuffer();
}

/**
 * Encode with the configured quality, then — if a max size is set — step
 * quality down by 5 (floor 50) until the file fits. PNG has no quality knob,
 * so it steps through palette quantization instead.
 */
export async function exportImage(img: RawImage, out: OutputSettings, meta: SourceMetadata = {}): Promise<StandardEditResult> {
  let quality = out.quality;
  let data = await encode(img, out, quality, meta, false);
  const limit = out.maxKb ? out.maxKb * 1024 : null;
  if (limit && data.length > limit) {
    if (out.format === "png") {
      for (let q = 100; q >= 50; q -= 5) {
        quality = q;
        data = await encode(img, out, q, meta, true);
        if (data.length <= limit) break;
      }
    } else {
      while (data.length > limit && quality - 5 >= 50) {
        quality -= 5;
        data = await encode(img, out, quality, meta, false);
      }
    }
  }
  return {
    data,
    width: img.width,
    height: img.height,
    sizeKb: Math.max(1, Math.round(data.length / 1024)),
    format: out.format,
    quality,
    maxKbMet: !limit || data.length <= limit,
  };
}

// ---------------------------------------------------------------- full pipeline

export interface StandardEditOptions {
  /** Downscale the source first (used by previews) */
  maxInputSide?: number;
  assets?: WatermarkAssets;
  /** Source used for metadata carry-over (defaults to `input`) */
  metadataSource?: Buffer;
}

export async function applyStandardEdits(
  input: Buffer,
  standard: StandardSettings,
  output: OutputSettings,
  opts: StandardEditOptions = {},
): Promise<StandardEditResult> {
  let img = await decode(input, opts.maxInputSide);
  if (standard.autoTrim.enabled) img = await autoTrim(img, standard.autoTrim.threshold);
  img = await cropToAspect(img, standard.crop);
  if (standard.fit.enabled) img = await fitToCanvas(img, standard.fit);
  if (standard.resize.enabled) img = await resize(img, standard.resize);
  img = await applyAdjustments(img, standard.adjustments);
  img = await applyWatermark(img, standard.watermark, opts.assets ?? {});
  const meta = output.stripMetadata ? {} : await readKeepableMetadata(opts.metadataSource ?? input);
  return exportImage(img, output, meta);
}

export const EXT_FOR_FORMAT: Record<OutputSettings["format"], string> = { jpg: "jpg", png: "png", webp: "webp" };
