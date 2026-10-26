/**
 * StorageAdapter — all file I/O goes through this interface so an S3/R2
 * adapter can be dropped in later. Keys are forward-slash relative paths such
 * as "batches/<batchId>/originals/<imageId>.jpg".
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { env } from "./env";

export interface StorageAdapter {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  getStream(key: string): Readable;
  getUrl(key: string): string;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

const KEY_SEGMENT = /^[A-Za-z0-9._-]+$/;

/**
 * Validate a storage key: relative, no "..", no empty/odd segments.
 * Returns the normalized key or null if unsafe.
 */
export function sanitizeKey(key: string): string | null {
  if (typeof key !== "string" || key.length === 0 || key.length > 512) return null;
  if (key.includes("\0") || key.includes("\\")) return null;
  if (key.startsWith("/")) return null;
  const parts = key.split("/");
  for (const p of parts) {
    if (!p || p === "." || p === ".." || !KEY_SEGMENT.test(p)) return null;
  }
  return parts.join("/");
}

export class LocalStorageAdapter implements StorageAdapter {
  constructor(private readonly root: string) {}

  /** Resolve a key to an absolute path, guaranteeing it stays inside root. */
  resolve(key: string): string {
    const safe = sanitizeKey(key);
    if (!safe) throw new StorageKeyError(key);
    const root = path.resolve(this.root);
    const full = path.resolve(root, safe);
    if (full !== root && !full.startsWith(root + path.sep)) throw new StorageKeyError(key);
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const full = this.resolve(key);
    await fsp.mkdir(path.dirname(full), { recursive: true });
    // Write to a temp file then rename so readers never see partial files.
    const tmp = `${full}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, data);
    await fsp.rename(tmp, full);
  }

  async get(key: string): Promise<Buffer> {
    return fsp.readFile(this.resolve(key));
  }

  getStream(key: string): Readable {
    return fs.createReadStream(this.resolve(key));
  }

  getUrl(key: string): string {
    return `/api/files/${key}`;
  }

  async delete(key: string): Promise<void> {
    await fsp.rm(this.resolve(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fsp.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}

export class StorageKeyError extends Error {
  constructor(key: string) {
    super(`Invalid storage key: ${JSON.stringify(key).slice(0, 80)}`);
    this.name = "StorageKeyError";
  }
}

let instance: StorageAdapter | null = null;
export function storage(): StorageAdapter {
  if (!instance) instance = new LocalStorageAdapter(env.storageDir);
  return instance;
}
/** For tests. */
export function setStorage(adapter: StorageAdapter | null) {
  instance = adapter;
}

export const keys = {
  original: (batchId: string, imageId: string, ext: string) => `batches/${batchId}/originals/${imageId}.${ext}`,
  ai: (batchId: string, imageId: string, hash: string) => `batches/${batchId}/ai/${imageId}-${hash.slice(0, 12)}.png`,
  edited: (batchId: string, imageId: string, ext: string, stamp: number) =>
    `batches/${batchId}/edited/${imageId}-${stamp}.${ext}`,
  watermark: (id: string) => `watermarks/${id}.png`,
  presetExample: (presetId: string) => `presets/${presetId}.webp`,
};

/** Every stored image gets a small WebP thumbnail next to it. */
export function thumbKeyFor(key: string): string {
  return key.replace(/\.[A-Za-z0-9]+$/, "") + ".thumb.webp";
}

export function fileUrl(key: string | null | undefined): string | null {
  return key ? `/api/files/${key}` : null;
}
