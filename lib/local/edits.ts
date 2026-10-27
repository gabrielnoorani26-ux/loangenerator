/**
 * Local (offline, free) implementation of the AI edits, driven by the
 * structured AiSettings rather than the prompt:
 *
 *   lighting      → tone curves + gray-world white balance (pure pixel math)
 *   background    → segmentation mask (lib/local/segment) composited over a
 *                   solid color or a procedurally generated scene backdrop
 *   shadow        → synthesized from the mask (ground / contact / reflection)
 *   straighten    → centers the product's bounding box (no rotation)
 *
 * Cleanup, custom scenes and free-text instructions need a generative model
 * and are ignored here (lib/local/support.ts lists them for the UI).
 */
import sharp from "sharp";
import { ProviderError } from "../providers/types";
import type { AiSettings, ScenePreset } from "../settings";
import type { Mask, Segmenter } from "./segment";

// ------------------------------------------------------------------ lighting

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/** Tone curve for the enabled lighting toggles (applied after white balance / stretch). */
export function lightingCurve(l: AiSettings["lighting"]): Uint8Array {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let x = i / 255;
    // Lift shadows: bump peaking around x≈0.25, zero at both ends.
    if (l.recoverShadows) x = x + 0.6 * x * (1 - x) ** 3;
    // Compress highlights: dip peaking around x≈0.75.
    if (l.reduceHighlights) x = x - 0.6 * x ** 3 * (1 - x);
    // Even brighten: gamma < 1 keeps black and white fixed.
    if (l.brighten) x = x ** 0.85;
    lut[i] = clamp255(x * 255);
  }
  return lut;
}

/** Gray-world white balance gains, clamped so strongly colored scenes aren't wrecked. */
export function whiteBalanceGains(rgba: Buffer): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    const lum = (rgba[i] + rgba[i + 1] + rgba[i + 2]) / 3;
    // Skip clipped pixels: they carry no color information.
    if (lum < 8 || lum > 250) continue;
    r += rgba[i];
    g += rgba[i + 1];
    b += rgba[i + 2];
    n++;
  }
  if (!n) return [1, 1, 1];
  const gray = (r + g + b) / (3 * n);
  const gain = (c: number) => Math.min(1.25, Math.max(0.8, gray / (c / n)));
  return [gain(r), gain(g), gain(b)];
}

/** Black/white points from the 0.5% / 99.5% luminance percentiles, limited to a gentle stretch. */
export function levelsRange(rgba: Buffer): [number, number] {
  const hist = new Uint32Array(256);
  let n = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    hist[Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2])]++;
    n++;
  }
  if (!n) return [0, 255];
  const pct = (p: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) if ((acc += hist[v]) >= n * p) return v;
    return 255;
  };
  return [Math.min(40, pct(0.005)), Math.max(200, pct(0.995))];
}

/** Apply the lighting toggles to RGBA pixels in place. */
export function applyLighting(rgba: Buffer, l: AiSettings["lighting"]): void {
  if (!Object.values(l).some(Boolean)) return;
  const gains = l.whiteBalance ? whiteBalanceGains(rgba) : ([1, 1, 1] as const);
  const [lo, hi] = l.trueColors ? levelsRange(rgba) : [0, 255];
  const scale = 255 / Math.max(1, hi - lo);
  const curve = lightingCurve(l);
  // One table per channel: gain → stretch → curve.
  const tables = [0, 1, 2].map((c) => {
    const t = new Uint8Array(256);
    for (let v = 0; v < 256; v++) t[v] = curve[clamp255((clamp255(v * gains[c]) - lo) * scale)];
    return t;
  });
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = tables[0][rgba[i]];
    rgba[i + 1] = tables[1][rgba[i + 1]];
    rgba[i + 2] = tables[2][rgba[i + 2]];
  }
}

// --------------------------------------------------------------- backdrops

interface SceneSpec {
  base: string;
  /** Optional procedural texture: noise color + strength */
  noise?: { type: "fractalNoise" | "turbulence"; freq: string; octaves: number; color: string; alpha: number };
  gradient?: [string, string];
}

/** Procedural stand-ins for the scene presets (no generative model in local mode). Frequencies are per 512px tile. */
export const LOCAL_SCENES: Record<ScenePreset, SceneSpec> = {
  studio_gray: { base: "#cfcfcf", gradient: ["#e6e6e6", "#a9a9a9"] },
  marble: {
    base: "#f3f2ef",
    noise: { type: "turbulence", freq: "0.004 0.012", octaves: 4, color: "#8f8f95", alpha: 0.55 },
  },
  wood_floor: {
    base: "#c49a6c",
    noise: { type: "fractalNoise", freq: "0.004 0.08", octaves: 3, color: "#6b4424", alpha: 0.9 },
  },
  concrete: {
    base: "#b4b2ad",
    noise: { type: "fractalNoise", freq: "0.6", octaves: 3, color: "#6e6c68", alpha: 0.55 },
  },
  pavement: {
    base: "#8d8c88",
    noise: { type: "fractalNoise", freq: "0.25", octaves: 3, color: "#3f3e3b", alpha: 0.7 },
  },
  beach_sand: {
    base: "#e2cda3",
    noise: { type: "fractalNoise", freq: "0.9", octaves: 2, color: "#a88a5a", alpha: 0.6 },
  },
  pastel: { base: "#efe1ea", gradient: ["#f7dfe6", "#dde7f6"] },
  custom: { base: "#cfcfcf", gradient: ["#e6e6e6", "#a9a9a9"] },
};

function hexRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const TILE = 512;
const tiles = new Map<ScenePreset, Promise<Buffer>>();

/**
 * Seamless noise tile (PNG with alpha). librsvg's feTurbulence is slow, so
 * each preset's tile is rendered once per process and repeated across the canvas.
 */
function noiseTile(preset: ScenePreset): Promise<Buffer> {
  let t = tiles.get(preset);
  if (!t) {
    const noise = LOCAL_SCENES[preset].noise!;
    const [r, g, b] = hexRgb(noise.color).map((c) => (c / 255).toFixed(3));
    // Constant color; alpha driven by the noise's red channel. stitchTiles makes the tile seamless.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}"><filter id="n" x="0" y="0" width="100%" height="100%"><feTurbulence type="${noise.type}" baseFrequency="${noise.freq}" numOctaves="${noise.octaves}" seed="7" stitchTiles="stitch"/><feColorMatrix type="matrix" values="0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} ${noise.alpha} 0 0 0 0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>`;
    t = sharp(Buffer.from(svg)).png().toBuffer();
    tiles.set(preset, t);
  }
  return t;
}

/** Render a scene backdrop as RGBA. */
export async function renderScene(preset: ScenePreset, width: number, height: number): Promise<Buffer> {
  const spec = LOCAL_SCENES[preset];
  // Gradients are smooth: draw them at ≤1024px and upscale.
  const k = Math.min(1, 1024 / Math.max(width, height));
  const w = Math.max(1, Math.round(width * k));
  const h = Math.max(1, Math.round(height * k));
  let defs = "";
  let layers = `<rect width="100%" height="100%" fill="${spec.base}"/>`;
  if (spec.gradient) {
    defs += `<radialGradient id="g" cx="50%" cy="40%" r="75%"><stop offset="0" stop-color="${spec.gradient[0]}"/><stop offset="1" stop-color="${spec.gradient[1]}"/></radialGradient>`;
    layers += `<rect width="100%" height="100%" fill="url(#g)"/>`;
  }
  // Soft top-to-bottom falloff for depth.
  defs += `<linearGradient id="v" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.12"/><stop offset="1" stop-color="#000" stop-opacity="0.10"/></linearGradient>`;
  layers += `<rect width="100%" height="100%" fill="url(#v)"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs>${defs}</defs>${layers}</svg>`;
  // Flatten the resized gradient first so the texture composites at full size.
  let img = sharp(await sharp(Buffer.from(svg)).resize(width, height, { fit: "fill" }).png().toBuffer());
  if (spec.noise) {
    // ~3 tiles across the long side keeps texture scale consistent between photo sizes.
    // The tile may not exceed the canvas (sharp's composite rule).
    const size = Math.min(width, height, Math.max(128, Math.round(Math.max(width, height) / 3)));
    const tile = await sharp(await noiseTile(preset))
      .resize(size, size)
      .png()
      .toBuffer();
    img = img.composite([{ input: tile, tile: true }]);
  }
  return img.ensureAlpha().raw().toBuffer();
}

function solid(width: number, height: number, hex: string): Buffer {
  const [r, g, b] = hexRgb(hex);
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = 255;
  }
  return out;
}

// ------------------------------------------------------------- mask helpers

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Bounding box of mask pixels ≥ 128, or null if there is no product. */
export function maskBox(mask: Mask): Box | null {
  const { data, width, height } = mask;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (data[row + x] >= 128) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

function shift(mask: Buffer, width: number, height: number, dx: number, dy: number): Buffer {
  if (!dx && !dy) return mask;
  const out = Buffer.alloc(mask.length);
  for (let y = 0; y < height; y++) {
    const sy = y - dy;
    if (sy < 0 || sy >= height) continue;
    for (let x = 0; x < width; x++) {
      const sx = x - dx;
      if (sx >= 0 && sx < width) out[y * width + x] = mask[sy * width + sx];
    }
  }
  return out;
}

async function blur1(data: Buffer, width: number, height: number, sigma: number): Promise<Buffer> {
  if (sigma < 0.3) return data;
  const out = await sharp(data, { raw: { width, height, channels: 1 } })
    .blur(sigma)
    .extractChannel(0)
    .raw()
    .toBuffer();
  return out;
}

/** Shadow intensity map (0..255) for the shadow style, given the product's (shifted) mask and box. */
export async function shadowMap(
  style: Exclude<AiSettings["shadow"], "none" | "reflection">,
  mask: Buffer,
  width: number,
  height: number,
  box: Box,
): Promise<Buffer> {
  const bw = box.x1 - box.x0 + 1;
  const bh = box.y1 - box.y0 + 1;
  const out = Buffer.alloc(width * height);
  if (style === "contact") {
    // Thin ellipse where the product meets the ground.
    const cx = (box.x0 + box.x1) / 2;
    const cy = box.y1 + bh * 0.005;
    const rx = bw * 0.48;
    const ry = Math.max(3, bw * 0.025);
    for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(height - 1, Math.ceil(cy + ry)); y++) {
      for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(width - 1, Math.ceil(cx + rx)); x++) {
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
        if (d < 1) out[y * width + x] = Math.round(255 * (1 - d));
      }
    }
    return blur1(out, width, height, Math.max(1, bw * 0.01));
  }
  // Soft ground shadow: the silhouette squashed onto the floor and heavily blurred.
  const squashH = Math.max(2, Math.round(bh * 0.12));
  const crop = Buffer.alloc(bw * bh);
  for (let y = 0; y < bh; y++)
    mask.copy(crop, y * bw, (box.y0 + y) * width + box.x0, (box.y0 + y) * width + box.x1 + 1);
  const squashed = await sharp(crop, { raw: { width: bw, height: bh, channels: 1 } })
    .resize(bw, squashH, { fit: "fill" })
    .extractChannel(0)
    .raw()
    .toBuffer();
  const top = box.y1 - Math.round(squashH * 0.6);
  for (let y = 0; y < squashH; y++) {
    const ty = top + y;
    if (ty < 0 || ty >= height) continue;
    for (let x = 0; x < bw; x++) out[ty * width + box.x0 + x] = squashed[y * bw + x];
  }
  return blur1(out, width, height, Math.max(2, bw * 0.03));
}

// --------------------------------------------------------------- the edit

export interface LocalEditOptions {
  ai: AiSettings;
  segment: Segmenter;
}

/** Apply the supported AI settings locally. Returns a PNG. */
export async function localEdit(image: Buffer, { ai, segment }: LocalEditOptions): Promise<Buffer> {
  const { data: src, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const replaceBg = ai.background.mode !== "none";
  const needsMask = replaceBg || ai.shadow !== "none" || ai.straighten;

  const pixels = Buffer.from(src);
  applyLighting(pixels, ai.lighting);
  if (!needsMask)
    return sharp(pixels, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer();

  const seg = await segment(image);
  if (seg.width !== width || seg.height !== height || seg.data.length !== width * height)
    throw new ProviderError("unknown", "segmentation size mismatch");
  // Respect existing transparency (cut-out PNGs).
  const alpha = Buffer.from(seg.data);
  for (let i = 0; i < alpha.length; i++) alpha[i] = Math.min(alpha[i], src[i * 4 + 3]);
  const box = maskBox({ data: alpha, width, height });
  if (!box) throw new ProviderError("bad_request", "Couldn't find a product in this photo");

  let dx = 0;
  let dy = 0;
  if (ai.straighten) {
    dx = Math.round((width - 1) / 2 - (box.x0 + box.x1) / 2);
    dy = Math.round((height - 1) / 2 - (box.y0 + box.y1) / 2);
  }
  const placed = { x0: box.x0 + dx, y0: box.y0 + dy, x1: box.x1 + dx, y1: box.y1 + dy };

  // Backdrop
  let base: Buffer;
  if (ai.background.mode === "solid") base = solid(width, height, ai.background.color);
  else if (ai.background.mode === "scene") base = await renderScene(ai.background.scenePreset, width, height);
  else {
    base = Buffer.from(pixels);
    if (dx || dy) fillProductHole(base, alpha, width, height);
  }

  // Shadow / reflection under the product
  const m = shift(alpha, width, height, dx, dy);
  if (ai.shadow === "soft" || ai.shadow === "contact") {
    const sh = await shadowMap(ai.shadow, m, width, height, placed);
    const strength = ai.shadow === "contact" ? 0.55 : 0.45;
    for (let i = 0, p = 0; i < sh.length; i++, p += 4) {
      const k = 1 - (sh[i] / 255) * strength;
      base[p] = Math.round(base[p] * k);
      base[p + 1] = Math.round(base[p + 1] * k);
      base[p + 2] = Math.round(base[p + 2] * k);
    }
  } else if (ai.shadow === "reflection") {
    const fade = Math.max(1, (placed.y1 - placed.y0 + 1) * 0.4);
    for (let y = placed.y1 + 1; y < height && y - placed.y1 <= fade; y++) {
      const sy = 2 * placed.y1 + 1 - y; // mirror about the product's bottom edge
      const t = 0.35 * (1 - (y - placed.y1) / fade);
      for (let x = placed.x0; x <= placed.x1; x++) {
        const a = (m[sy * width + x] / 255) * t;
        if (!a) continue;
        const p = (y * width + x) * 4;
        const q = ((sy - dy) * width + (x - dx)) * 4;
        for (let c = 0; c < 3; c++) base[p + c] = Math.round(base[p + c] * (1 - a) + pixels[q + c] * a);
      }
    }
  }

  // Product on top
  for (let y = placed.y0; y <= placed.y1; y++) {
    for (let x = placed.x0; x <= placed.x1; x++) {
      const a = m[y * width + x] / 255;
      if (!a) continue;
      const p = (y * width + x) * 4;
      const q = ((y - dy) * width + (x - dx)) * 4;
      for (let c = 0; c < 3; c++) base[p + c] = Math.round(base[p + c] * (1 - a) + pixels[q + c] * a);
      base[p + 3] = Math.max(base[p + 3], Math.round(a * 255));
    }
  }
  return sharp(base, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

/** Paint over the product's old position with the median border color (used when centering on "Keep" backgrounds). */
function fillProductHole(rgba: Buffer, alpha: Buffer, width: number, height: number) {
  const samples: number[][] = [[], [], []];
  const take = (x: number, y: number) => {
    const p = (y * width + x) * 4;
    for (let c = 0; c < 3; c++) samples[c].push(rgba[p + c]);
  };
  for (let x = 0; x < width; x += 4) {
    take(x, 0);
    take(x, height - 1);
  }
  for (let y = 0; y < height; y += 4) {
    take(0, y);
    take(width - 1, y);
  }
  const med = samples.map((s) => s.sort((a, b) => a - b)[s.length >> 1]);
  for (let i = 0, p = 0; i < alpha.length; i++, p += 4) {
    // Dilate a little by treating faint mask values as product.
    const a = Math.min(1, alpha[i] / 64);
    if (!a) continue;
    for (let c = 0; c < 3; c++) rgba[p + c] = Math.round(rgba[p + c] * (1 - a) + med[c] * a);
  }
}
