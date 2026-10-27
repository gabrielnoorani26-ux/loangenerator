/**
 * Product segmentation on this machine: one ONNX session per model, runs
 * serialized (a CPU-bound network gains nothing from parallel runs and would
 * multiply memory). Tests inject a fake via setSegmenter().
 */
import pLimit from "p-limit";
import sharp from "sharp";
import { ensureModel, modelSpec, type ModelSpec } from "./models";

/** Single-channel alpha mask (0 = background, 255 = product) at the image's size. */
export interface Mask {
  data: Buffer;
  width: number;
  height: number;
}

/** Input must already be oriented (no EXIF rotation pending). */
export type Segmenter = (image: Buffer) => Promise<Mask>;

type Ort = typeof import("onnxruntime-node");
const sessions = new Map<string, Promise<import("onnxruntime-node").InferenceSession>>();
const runLimit = pLimit(1);
let override: Segmenter | null = null;

async function session(spec: ModelSpec) {
  let s = sessions.get(spec.name);
  if (!s) {
    s = (async () => {
      const file = await ensureModel(spec);
      const ort: Ort = await import("onnxruntime-node");
      return ort.InferenceSession.create(file, { graphOptimizationLevel: "all" });
    })();
    // Don't cache a failed load (e.g. offline): retry on the next image.
    s.catch(() => sessions.delete(spec.name));
    sessions.set(spec.name, s);
  }
  return s;
}

/**
 * Soft matte → cleaner alpha: drops the faint haze the networks leave on
 * backgrounds and makes the product body fully opaque, keeping edges soft.
 */
export function refineAlpha(v: number): number {
  const lo = 0.08 * 255;
  const hi = 0.92 * 255;
  if (v <= lo) return 0;
  if (v >= hi) return 255;
  return Math.round(((v - lo) / (hi - lo)) * 255);
}

async function runModel(image: Buffer): Promise<Mask> {
  const spec = modelSpec();
  const sess = await session(spec);
  const ort: Ort = await import("onnxruntime-node");
  const meta = await sharp(image).metadata();
  const width = meta.width!;
  const height = meta.height!;
  const n = spec.size * spec.size;
  const rgb = await sharp(image)
    .flatten({ background: "#ffffff" })
    .resize(spec.size, spec.size, { fit: "fill" })
    .raw()
    .toBuffer();
  let max = 1;
  for (let i = 0; i < rgb.length; i++) if (rgb[i] > max) max = rgb[i];
  const input = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) input[c * n + i] = (rgb[i * 3 + c] / max - spec.mean[c]) / spec.std[c];
  }
  const out = await runLimit(() =>
    sess.run({ [sess.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, spec.size, spec.size]) }),
  );
  const pred = out[sess.outputNames[0]].data as Float32Array;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    if (pred[i] < lo) lo = pred[i];
    if (pred[i] > hi) hi = pred[i];
  }
  const range = hi - lo || 1;
  const small = Buffer.alloc(n);
  for (let i = 0; i < n; i++) small[i] = Math.round(((pred[i] - lo) / range) * 255);
  const data = await sharp(small, { raw: { width: spec.size, height: spec.size, channels: 1 } })
    .resize(width, height, { fit: "fill", kernel: "lanczos3" })
    // sharp widens 1-channel raw input to sRGB; keep a single channel.
    .extractChannel(0)
    .raw()
    .toBuffer();
  for (let i = 0; i < data.length; i++) data[i] = refineAlpha(data[i]);
  return { data, width, height };
}

export const segment: Segmenter = (image) => (override ?? runModel)(image);

/** For tests. */
export function setSegmenter(fn: Segmenter | null) {
  override = fn;
}

/** Load the model now (downloading it if needed) so the first image isn't slow. */
export async function warmUp(): Promise<void> {
  await session(modelSpec());
}
