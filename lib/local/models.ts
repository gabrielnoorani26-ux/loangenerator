/**
 * Open-source background-segmentation models for local mode (Apache-2.0,
 * published by the rembg project as ONNX files). Downloaded once into
 * MODELS_DIR on first use (or `npm run models`) and verified by sha256;
 * after that everything runs offline.
 *
 *   isnet  — IS-Net general use, 1024² input, ~180 MB, best edges (default)
 *   u2netp — U²-Net portable, 320² input, ~4.5 MB, fast but softer edges
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env } from "../env";
import { ProviderError } from "../providers/types";

export interface ModelSpec {
  name: string;
  file: string;
  url: string;
  sha256: string;
  /** Square input size the network expects */
  size: number;
  mean: [number, number, number];
  std: [number, number, number];
}

const RELEASE = "https://github.com/danielgatis/rembg/releases/download/v0.0.0";

export const MODELS: Record<string, ModelSpec> = {
  isnet: {
    name: "isnet",
    file: "isnet-general-use.onnx",
    url: `${RELEASE}/isnet-general-use.onnx`,
    sha256: "60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a",
    size: 1024,
    mean: [0.5, 0.5, 0.5],
    std: [1, 1, 1],
  },
  u2netp: {
    name: "u2netp",
    file: "u2netp.onnx",
    url: `${RELEASE}/u2netp.onnx`,
    sha256: "309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8",
    size: 320,
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225],
  },
};

export function modelSpec(name = env.localModel): ModelSpec {
  const spec = MODELS[name];
  if (!spec) throw new ProviderError("not_configured", `Unknown LOCAL_MODEL "${name}" (use isnet or u2netp)`);
  return spec;
}

export function modelPath(spec: ModelSpec): string {
  return path.join(env.modelsDir, spec.file);
}

export function modelDownloaded(spec = modelSpec()): boolean {
  return fs.existsSync(modelPath(spec));
}

const pending = new Map<string, Promise<string>>();

/** Path to the model file, downloading it first if needed (one download at a time per model). */
export function ensureModel(spec = modelSpec()): Promise<string> {
  const file = modelPath(spec);
  if (fs.existsSync(file)) return Promise.resolve(file);
  let p = pending.get(spec.name);
  if (!p) {
    p = download(spec, file).finally(() => pending.delete(spec.name));
    pending.set(spec.name, p);
  }
  return p;
}

async function download(spec: ModelSpec, file: string): Promise<string> {
  console.log(`[local] downloading ${spec.file} (one-time) → ${file}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let res: Response;
  try {
    res = await fetch(spec.url, { redirect: "follow" });
  } catch (err) {
    throw new ProviderError(
      "network",
      `Could not download the background model (${err instanceof Error ? err.message : err}). Run "npm run models" once while online.`,
    );
  }
  if (!res.ok) throw new ProviderError("network", `Model download failed: HTTP ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  const digest = createHash("sha256").update(data).digest("hex");
  if (digest !== spec.sha256) throw new ProviderError("network", `Model download is corrupt (sha256 ${digest})`);
  const tmp = `${file}.part`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
  console.log(`[local] ${spec.file} ready`);
  return file;
}
