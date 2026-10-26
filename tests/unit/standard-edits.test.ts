import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  adjustmentParams,
  applyAdjustments,
  applyStandardEdits,
  applyWatermark,
  autoTrim,
  cropRect,
  cropToAspect,
  decode,
  exportImage,
  fitToCanvas,
  resize,
  resizeDims,
  watermarkPosition,
  type RawImage,
} from "@/lib/standard-edits";
import { defaultEditSettings, StandardSettingsSchema, OutputSettingsSchema } from "@/lib/settings";

/** Solid background with a colored rectangle "product". */
async function productImage(w = 400, h = 300, opts: { bg?: string; transparent?: boolean; noise?: boolean } = {}): Promise<Buffer> {
  const bg = opts.transparent ? "" : `<rect width="100%" height="100%" fill="${opts.bg ?? "#eeeeee"}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${bg}
    <rect x="${w * 0.25}" y="${h * 0.3}" width="${w * 0.5}" height="${h * 0.4}" fill="#c0392b"/>
    <rect x="${w * 0.25}" y="${h * 0.6}" width="${w * 0.5}" height="${h * 0.1}" fill="#2c3e50"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function pixel(img: RawImage, x: number, y: number) {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

async function stats(img: RawImage) {
  return sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } }).removeAlpha().stats();
}

const std = (over: object = {}) => StandardSettingsSchema.parse(over);
const out = (over: object = {}) => OutputSettingsSchema.parse(over);

describe("auto-trim", () => {
  it("trims uniform borders to the product", async () => {
    const img = await decode(await productImage(400, 300));
    const t = await autoTrim(img, 10);
    expect(t.width).toBe(200);
    expect(t.height).toBe(120);
  });
  it("leaves a fully uniform image untouched", async () => {
    const flat = await sharp({ create: { width: 50, height: 40, channels: 3, background: "#fff" } }).png().toBuffer();
    const img = await decode(flat);
    const t = await autoTrim(img, 10);
    expect([t.width, t.height]).toEqual([50, 40]);
  });
  it("trims transparent borders", async () => {
    const img = await decode(await productImage(400, 300, { transparent: true }));
    const t = await autoTrim(img, 10);
    expect([t.width, t.height]).toEqual([200, 120]);
  });
});

describe("crop to aspect", () => {
  it("computes centered crops for wide images", () => {
    expect(cropRect(300, 200, 1, "center")).toEqual({ left: 50, top: 0, width: 200, height: 200 });
  });
  it("respects the vertical anchor for tall images", () => {
    expect(cropRect(200, 400, 1, "top")).toEqual({ left: 0, top: 0, width: 200, height: 200 });
    expect(cropRect(200, 400, 1, "bottom")).toEqual({ left: 0, top: 200, width: 200, height: 200 });
    expect(cropRect(200, 400, 1, "center")).toEqual({ left: 0, top: 100, width: 200, height: 200 });
  });
  it("is a no-op when the ratio already matches", () => {
    expect(cropRect(400, 500, 4 / 5, "center")).toEqual({ left: 0, top: 0, width: 400, height: 500 });
  });
  it("crops to 4:5 and custom ratios", async () => {
    const img = await decode(await productImage(400, 300));
    const c = await cropToAspect(img, std({ crop: { aspect: "4:5" } }).crop);
    expect(c.width / c.height).toBeCloseTo(0.8, 2);
    const c2 = await cropToAspect(img, std({ crop: { aspect: "custom", customWidth: 2, customHeight: 1 } }).crop);
    expect([c2.width, c2.height]).toEqual([400, 200]);
    const same = await cropToAspect(img, std().crop);
    expect(same).toBe(img);
  });
});

describe("fit to canvas", () => {
  it("produces exact canvas size with padding and fill color", async () => {
    const img = await autoTrim(await decode(await productImage(400, 300)), 10);
    const f = await fitToCanvas(img, std({ fit: { enabled: true, width: 1000, height: 1000, paddingPct: 10, fillColor: "#00ff00" } }).fit);
    expect([f.width, f.height]).toEqual([1000, 1000]);
    expect(await pixel(f, 5, 5)).toEqual([0, 255, 0, 255]);
    // product spans the inner width (80% of 1000) and is centered
    expect((await pixel(f, 101, 500))[0]).toBeGreaterThan(150); // red product at left edge of inner box
    expect(await pixel(f, 95, 500)).toEqual([0, 255, 0, 255]); // padding area
  });
  it("keeps the product fully visible at 40% padding", async () => {
    const img = await decode(await productImage(400, 300, { transparent: true }));
    const f = await fitToCanvas(img, std({ fit: { enabled: true, width: 500, height: 500, paddingPct: 40 } }).fit);
    expect([f.width, f.height]).toEqual([500, 500]);
  });
});

describe("resize", () => {
  const r = (o: object) => std({ resize: { enabled: true, ...o } }).resize;
  it("computes dims for each mode", () => {
    expect(resizeDims(4000, 3000, r({ mode: "longest", value: 1600 }))).toMatchObject({ width: 1600, height: 1200 });
    expect(resizeDims(4000, 3000, r({ mode: "shortest", value: 600 }))).toMatchObject({ width: 800, height: 600 });
    expect(resizeDims(4000, 3000, r({ mode: "percentage", value: 25 }))).toMatchObject({ width: 1000, height: 750 });
    expect(resizeDims(4000, 3000, r({ mode: "exact", width: 500, height: 500, lockAspect: true }))).toEqual({
      width: 500,
      height: 500,
      fit: "cover",
    });
    expect(resizeDims(4000, 3000, r({ mode: "exact", width: 500, height: 500, lockAspect: false })).fit).toBe("fill");
  });
  it("resizes pixels", async () => {
    const img = await decode(await productImage(400, 300));
    const out1 = await resize(img, r({ mode: "exact", width: 120, height: 90 }));
    expect([out1.width, out1.height]).toEqual([120, 90]);
  });
});

describe("adjustments", () => {
  const adj = (o: object) => std({ adjustments: o }).adjustments;
  it("documents the slider mapping", () => {
    const p = adjustmentParams(adj({ brightness: 100, saturation: -100, contrast: 150 > 100 ? 100 : 0, warmth: 100, sharpness: 50 }));
    expect(p.brightness).toBe(1.5);
    expect(p.saturation).toBe(0);
    expect(p.contrast.a).toBeCloseTo(1 + 100 / 150);
    expect(p.warmth.a).toEqual([1.25, 1, 0.75]);
    expect(p.sharpenSigma).toBe(1.25);
    expect(p.blurSigma).toBeNull();
    expect(adjustmentParams(adj({ sharpness: -100 })).blurSigma).toBeCloseTo(2.3);
  });
  it("brightness raises the mean", async () => {
    const img = await decode(await productImage(200, 150, { bg: "#808080" }));
    const before = await stats(img);
    const after = await stats(await applyAdjustments(img, adj({ brightness: 60 })));
    expect(after.channels[1].mean).toBeGreaterThan(before.channels[1].mean + 10);
  });
  it("saturation -100 produces grayscale", async () => {
    const img = await decode(await productImage(200, 150));
    const g = await applyAdjustments(img, adj({ saturation: -100 }));
    const [r, gg, b] = await pixel(g, 100, 70);
    expect(Math.abs(r - gg)).toBeLessThan(3);
    expect(Math.abs(gg - b)).toBeLessThan(3);
  });
  it("warmth shifts red up and blue down", async () => {
    const img = await decode(await productImage(200, 150, { bg: "#808080" }));
    const w = await applyAdjustments(img, adj({ warmth: 100 }));
    const [r, , b] = await pixel(w, 2, 2);
    expect(r).toBeGreaterThan(140);
    expect(b).toBeLessThan(110);
  });
  it("contrast increases spread", async () => {
    const img = await decode(await productImage(200, 150, { bg: "#a0a0a0" }));
    const before = await stats(img);
    const after = await stats(await applyAdjustments(img, adj({ contrast: 80 })));
    expect(after.channels[0].stdev).toBeGreaterThan(before.channels[0].stdev);
  });
  it("sharpen and blur run and preserve alpha", async () => {
    const img = await decode(await productImage(200, 150, { transparent: true }));
    for (const sharpness of [80, -80]) {
      const s = await applyAdjustments(img, adj({ sharpness }));
      expect((await pixel(s, 1, 1))[3]).toBe(0);
      expect((await pixel(s, 100, 70))[3]).toBe(255);
    }
  });
  it("is a no-op at zero", async () => {
    const img = await decode(await productImage(50, 50));
    expect(await applyAdjustments(img, adj({}))).toBe(img);
  });
});

describe("watermark", () => {
  it("computes 9-point positions with margin", () => {
    expect(watermarkPosition("top-left", 1000, 800, 100, 50, 10)).toEqual({ left: 10, top: 10 });
    expect(watermarkPosition("bottom-right", 1000, 800, 100, 50, 10)).toEqual({ left: 890, top: 740 });
    expect(watermarkPosition("center", 1000, 800, 100, 50, 10)).toEqual({ left: 450, top: 375 });
    expect(watermarkPosition("middle-left", 1000, 800, 100, 50, 10)).toEqual({ left: 10, top: 375 });
    expect(watermarkPosition("top-center", 1000, 800, 100, 50, 10)).toEqual({ left: 450, top: 10 });
  });
  it("composites a text watermark in the chosen corner only", async () => {
    const base = await decode(await sharp({ create: { width: 600, height: 400, channels: 3, background: "#203040" } }).png().toBuffer());
    const wm = std({ watermark: { enabled: true, type: "text", text: "BATCHLENS", position: "bottom-right", sizePct: 30, opacity: 100 } }).watermark;
    const w = await applyWatermark(base, wm, {});
    const br = await stats({ ...w, data: await sharp(w.data, { raw: { width: 600, height: 400, channels: 4 } }).extract({ left: 400, top: 320, width: 200, height: 80 }).raw().toBuffer(), width: 200, height: 80 });
    expect(br.channels[0].max).toBeGreaterThan(200); // white text present
    expect(await pixel(w, 5, 5)).toEqual(await pixel(base, 5, 5));
  });
  it("applies logo opacity", async () => {
    const base = await decode(await sharp({ create: { width: 400, height: 400, channels: 3, background: "#000" } }).png().toBuffer());
    const logo = await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } }).png().toBuffer();
    const wm = std({ watermark: { enabled: true, type: "logo", position: "center", sizePct: 25, opacity: 50, marginPct: 0 } }).watermark;
    const w = await applyWatermark(base, wm, { logo });
    const [r] = await pixel(w, 200, 200);
    expect(r).toBeGreaterThan(110);
    expect(r).toBeLessThan(145);
  });
  it("is skipped when disabled or empty", async () => {
    const base = await decode(await productImage(100, 100));
    expect(await applyWatermark(base, std().watermark, {})).toBe(base);
    expect(await applyWatermark(base, std({ watermark: { enabled: true, type: "logo" } }).watermark, {})).toBe(base);
  });
});

describe("export", () => {
  it("flattens transparency onto the fill color for JPG", async () => {
    const img = await decode(await productImage(200, 150, { transparent: true }));
    const r = await exportImage(img, out({ format: "jpg", flattenColor: "#FFFFFF" }));
    const meta = await sharp(r.data).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.hasAlpha).toBe(false);
    const { data } = await sharp(r.data).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(250);
  });
  it("keeps alpha for PNG and WEBP", async () => {
    const img = await decode(await productImage(200, 150, { transparent: true }));
    for (const format of ["png", "webp"] as const) {
      const r = await exportImage(img, out({ format }));
      expect((await sharp(r.data).metadata()).hasAlpha).toBe(true);
    }
  });
  it("steps quality down by 5 to meet max KB, with floor 50", async () => {
    const noisy = await sharp(Buffer.from(Array.from({ length: 600 * 600 * 3 }, () => Math.floor(Math.random() * 256))), {
      raw: { width: 600, height: 600, channels: 3 },
    })
      .png()
      .toBuffer();
    const img = await decode(noisy);
    const big = await exportImage(img, out({ format: "jpg", quality: 95 }));
    const target = Math.round(big.sizeKb * 0.7);
    const r = await exportImage(img, out({ format: "jpg", quality: 95, maxKb: target }));
    expect(r.sizeKb).toBeLessThanOrEqual(target);
    expect((95 - r.quality) % 5).toBe(0);
    expect(r.quality).toBeLessThan(95);
    const impossible = await exportImage(img, out({ format: "jpg", quality: 95, maxKb: 10 }));
    expect(impossible.quality).toBe(50);
    expect(impossible.maxKbMet).toBe(false);
  });
  it("strips metadata by default and keeps descriptive EXIF when asked", async () => {
    const src = await sharp(await productImage(100, 100))
      .jpeg()
      .withExif({ IFD0: { Copyright: "Chelsea Crew", Artist: "Studio A" } })
      .toBuffer();
    const stripped = await applyStandardEdits(src, std(), out({ format: "jpg" }));
    expect((await sharp(stripped.data).metadata()).exif).toBeUndefined();
    const kept = await applyStandardEdits(src, std(), out({ format: "jpg", stripMetadata: false }));
    const exif = (await sharp(kept.data).metadata()).exif;
    expect(exif?.toString("latin1")).toContain("Chelsea Crew");
  });
});

describe("full pipeline", () => {
  it("runs trim → crop → fit → resize → adjust → watermark → export in order", async () => {
    const s = defaultEditSettings();
    s.standard.autoTrim.enabled = true;
    s.standard.fit = { enabled: true, width: 800, height: 800, paddingPct: 10, fillColor: "#FFFFFF" };
    s.standard.resize = { ...s.standard.resize, enabled: true, mode: "longest", value: 400 };
    s.standard.adjustments.sharpness = 10;
    s.standard.watermark = { ...s.standard.watermark, enabled: true, text: "CC", position: "bottom-right" };
    s.output.format = "webp";
    const r = await applyStandardEdits(await productImage(1200, 900), s.standard, s.output);
    expect([r.width, r.height]).toEqual([400, 400]);
    expect((await sharp(r.data).metadata()).format).toBe("webp");
  });
  it("honours EXIF orientation", async () => {
    const src = await sharp(await productImage(300, 200)).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const r = await applyStandardEdits(src, std(), out());
    expect([r.width, r.height]).toEqual([200, 300]);
  });
});
