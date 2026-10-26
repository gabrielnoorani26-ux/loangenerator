import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { LocalStorageAdapter, sanitizeKey, storage, StorageKeyError } from "@/lib/storage";
import { sniffImageType } from "@/lib/mime";
import { ingestImage, UploadValidationError } from "@/lib/ingest";
import { GET as filesGET } from "@/app/api/files/[...key]/route";

const ctx = (parts: string[]) => ({ params: Promise.resolve({ key: parts }) }) as never;

describe("storage key sanitization", () => {
  it.each([
    "../.env",
    "batches/../../.env",
    "/etc/passwd",
    "batches/x/..",
    "a//b",
    "a\\b",
    "a/\0b",
    ".",
    "",
    "batches/%2e%2e/x",
    "batches/x y.jpg",
  ])("rejects %j", (k) => {
    expect(sanitizeKey(k)).toBeNull();
  });
  it("accepts normal keys", () => {
    expect(sanitizeKey("batches/abc/originals/c1.jpg")).toBe("batches/abc/originals/c1.jpg");
    expect(sanitizeKey("presets/x-1.thumb.webp")).toBe("presets/x-1.thumb.webp");
  });
  it("adapter refuses to resolve outside its root", () => {
    const a = new LocalStorageAdapter("/tmp/root");
    expect(() => a.resolve("../escape")).toThrow(StorageKeyError);
    expect(a.resolve("ok/file.png")).toBe("/tmp/root/ok/file.png");
  });
});

describe("GET /api/files/[...key]", () => {
  it("blocks path traversal attempts", async () => {
    for (const parts of [
      ["..", ".env"],
      ["%2e%2e", ".env"],
      ["batches", "..", "..", "package.json"],
      ["..%2F.env"],
      ["%2Fetc", "passwd"],
    ]) {
      const res = await filesGET(new Request("http://x/api/files/" + parts.join("/")), ctx(parts));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: { code: "invalid_key", message: "Invalid file path" } });
    }
  });
  it("serves a stored file with the right content type and cache headers", async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#f00" } })
      .png()
      .toBuffer();
    await storage().put("tests/red.png", png);
    const res = await filesGET(new Request("http://x/api/files/tests/red.png"), ctx(["tests", "red.png"]));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await res.arrayBuffer()).equals(png)).toBe(true);
  });
  it("404s for missing files", async () => {
    const res = await filesGET(new Request("http://x/api/files/tests/nope.png"), ctx(["tests", "nope.png"]));
    expect(res.status).toBe(404);
  });
});

describe("upload validation by file signature", () => {
  it("detects types from magic bytes, not extensions", async () => {
    const jpg = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#fff" } })
      .jpeg()
      .toBuffer();
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#fff" } })
      .png()
      .toBuffer();
    const webp = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#fff" } })
      .webp()
      .toBuffer();
    expect(sniffImageType(jpg)).toBe("jpg");
    expect(sniffImageType(png)).toBe("png");
    expect(sniffImageType(webp)).toBe("webp");
    const heicHeader = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(16)]);
    expect(sniffImageType(heicHeader)).toBe("heic");
    expect(sniffImageType(Buffer.from("GIF89a........"))).toBeNull();
    expect(sniffImageType(Buffer.from("<svg xmlns=...></svg>"))).toBeNull();
  });
  it("rejects a text file named .jpg", async () => {
    await expect(ingestImage(Buffer.from("not really an image at all"), "fake.jpg", 1e6)).rejects.toThrow(
      /unsupported file type/,
    );
  });
  it("rejects files over the size limit and empty files", async () => {
    await expect(ingestImage(Buffer.alloc(2 * 1024 * 1024, 1), "big.jpg", 1024 * 1024)).rejects.toBeInstanceOf(
      UploadValidationError,
    );
    await expect(ingestImage(Buffer.alloc(0), "empty.jpg", 1e6)).rejects.toThrow(/empty/);
  });
  it("rejects a corrupt image with a valid signature", async () => {
    const header = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    await expect(ingestImage(header, "corrupt.jpg", 1e6)).rejects.toThrow(/corrupt|unreadable|dimensions/);
  });
  it("reads oriented dimensions", async () => {
    const rotated = await sharp({ create: { width: 30, height: 20, channels: 3, background: "#123" } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const r = await ingestImage(rotated, "r.jpg", 1e6);
    expect([r.width, r.height]).toEqual([20, 30]);
    expect(r.ext).toBe("jpg");
  });
});
