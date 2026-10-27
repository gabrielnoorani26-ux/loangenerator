import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  applyLighting,
  levelsRange,
  lightingCurve,
  localEdit,
  maskBox,
  renderScene,
  whiteBalanceGains,
} from "@/lib/local/edits";
import { modelSpec } from "@/lib/local/models";
import { refineAlpha, type Segmenter } from "@/lib/local/segment";
import { localUnsupportedEdits } from "@/lib/local/support";
import { LocalQcProvider, runQc } from "@/lib/qc";
import { AiSettingsSchema, type AiSettings } from "@/lib/settings";
import { estimateRun } from "@/lib/estimate";
import { EditSettingsSchema } from "@/lib/settings";
import { productPng } from "./helpers";

/** Fake segmenter: anything clearly darker than the #eeeeee backdrop is product. */
const fakeSegment: Segmenter = async (image) => {
  const { data, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const mask = Buffer.alloc(info.width * info.height);
  for (let i = 0; i < mask.length; i++) {
    const lum = (data[i * 3] + data[i * 3 + 1] + data[i * 3 + 2]) / 3;
    mask[i] = lum < 200 ? 255 : 0;
  }
  return { data: mask, width: info.width, height: info.height };
};

const ai = (input: unknown): AiSettings => AiSettingsSchema.parse(input);

async function pixel(png: Buffer, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const p = (y * info.width + x) * 4;
  return [data[p], data[p + 1], data[p + 2], data[p + 3]];
}

describe("local edits", () => {
  it("replaces the background with a solid color and keeps the product pixels", async () => {
    const src = await productPng("#aa3322", 300, 200);
    const out = await localEdit(src, {
      ai: ai({ background: { mode: "solid", color: "#00FF00" } }),
      segment: fakeSegment,
    });
    expect((await pixel(out, 5, 5)).slice(0, 3)).toEqual([0, 255, 0]);
    expect((await pixel(out, 150, 100)).slice(0, 3)).toEqual([0xaa, 0x33, 0x22]);
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([300, 200]);
  });

  it("centers the product when straighten is on", async () => {
    // Product in the top-left corner.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="100%" height="100%" fill="#eeeeee"/><rect x="10" y="10" width="40" height="40" fill="#222222"/></svg>`;
    const src = await sharp(Buffer.from(svg)).png().toBuffer();
    const out = await localEdit(src, {
      ai: ai({ background: { mode: "solid", color: "#FFFFFF" }, straighten: true }),
      segment: fakeSegment,
    });
    expect((await pixel(out, 100, 100)).slice(0, 3)).toEqual([0x22, 0x22, 0x22]);
    expect((await pixel(out, 20, 20)).slice(0, 3)).toEqual([255, 255, 255]);
  });

  it("draws a shadow below the product on a plain background", async () => {
    const src = await productPng("#222222", 300, 200);
    const plain = await localEdit(src, { ai: ai({ background: { mode: "solid" } }), segment: fakeSegment });
    const shadowed = await localEdit(src, {
      ai: ai({ background: { mode: "solid" }, shadow: "contact" }),
      segment: fakeSegment,
    });
    // Just below the product's bottom edge (y = 150).
    expect((await pixel(plain, 150, 152))[0]).toBe(255);
    expect((await pixel(shadowed, 150, 152))[0]).toBeLessThan(250);
  });

  it("lighting-only edits don't need segmentation", async () => {
    const src = await productPng("#555555");
    const segment: Segmenter = () => Promise.reject(new Error("should not segment"));
    const out = await localEdit(src, { ai: ai({ lighting: { brighten: true } }), segment });
    expect((await pixel(out, 150, 100))[0]).toBeGreaterThan(0x55);
  });

  it("fails clearly when no product is found", async () => {
    const empty: Segmenter = async (img) => {
      const m = await sharp(img).metadata();
      return { data: Buffer.alloc(m.width! * m.height!), width: m.width!, height: m.height! };
    };
    await expect(
      localEdit(await productPng(), { ai: ai({ background: { mode: "solid" } }), segment: empty }),
    ).rejects.toThrow(/Couldn't find a product/);
  });

  it("renders every scene preset at the requested size", async () => {
    for (const preset of ["studio_gray", "marble", "wood_floor", "pastel"] as const) {
      const buf = await renderScene(preset, 120, 80);
      expect(buf.length).toBe(120 * 80 * 4);
    }
  });
});

describe("local lighting math", () => {
  it("curves keep black and white fixed", () => {
    const lut = lightingCurve({
      whiteBalance: false,
      brighten: true,
      recoverShadows: true,
      reduceHighlights: true,
      trueColors: false,
    });
    expect(lut[0]).toBe(0);
    expect(lut[255]).toBe(255);
  });
  it("shadow recovery lifts darks, highlight reduction lowers brights", () => {
    const base = { whiteBalance: false, brighten: false, trueColors: false };
    expect(lightingCurve({ ...base, recoverShadows: true, reduceHighlights: false })[60]).toBeGreaterThan(60);
    expect(lightingCurve({ ...base, recoverShadows: false, reduceHighlights: true })[200]).toBeLessThan(200);
  });
  it("gray-world white balance neutralizes a color cast (within clamps)", () => {
    const px = Buffer.alloc(4 * 100);
    for (let i = 0; i < px.length; i += 4) px.set([150, 120, 100, 255], i);
    const [r, , b] = whiteBalanceGains(px);
    expect(r).toBeLessThan(1);
    expect(b).toBeGreaterThan(1);
    applyLighting(px, {
      whiteBalance: true,
      brighten: false,
      recoverShadows: false,
      reduceHighlights: false,
      trueColors: false,
    });
    expect(Math.abs(px[0] - px[2])).toBeLessThan(50 - 10);
  });
  it("levels stretch is limited", () => {
    const px = Buffer.alloc(4 * 100);
    for (let i = 0; i < px.length; i += 4) px.set([128, 128, 128, 255], i);
    expect(levelsRange(px)).toEqual([40, 200]);
  });
  it("refineAlpha clears haze and solidifies the body", () => {
    expect(refineAlpha(10)).toBe(0);
    expect(refineAlpha(250)).toBe(255);
    expect(refineAlpha(128)).toBeGreaterThan(100);
  });
  it("maskBox finds the product bounds", () => {
    const data = Buffer.alloc(100);
    data[3 * 10 + 2] = 255;
    data[7 * 10 + 8] = 255;
    expect(maskBox({ data, width: 10, height: 10 })).toEqual({ x0: 2, y0: 3, x1: 8, y1: 7 });
    expect(maskBox({ data: Buffer.alloc(100), width: 10, height: 10 })).toBeNull();
  });
});

describe("local QC", () => {
  it("passes an untouched product and flags a changed one", async () => {
    const qc = new LocalQcProvider(fakeSegment);
    const src = await productPng("#aa3322", 300, 200);
    const edited = await localEdit(src, { ai: ai({ background: { mode: "solid" } }), segment: fakeSegment });
    expect((await runQc(qc, src, edited, 70)).verdict).toBe("pass");
    const altered = await productPng("#2233aa", 300, 200);
    const bad = await runQc(qc, src, altered, 70);
    expect(bad.verdict).toBe("review");
    expect(bad.issues.join(" ")).toMatch(/colors/);
  });
});

describe("local mode bookkeeping", () => {
  it("lists the options local mode skips", () => {
    expect(localUnsupportedEdits(ai({ lighting: { brighten: true } }))).toEqual([]);
    expect(localUnsupportedEdits(ai({ cleanup: { dust: true }, customInstruction: "x" }), "y")).toEqual([
      "Cleanup",
      "Custom instruction",
      "Per-image instruction",
    ]);
  });
  it("estimates zero cost with free prices", () => {
    const settings = EditSettingsSchema.parse({ ai: { background: { mode: "solid" } } });
    const img = { useOriginal: false, perImageInstruction: null, aiSettingsHash: null, aiIntermediateKey: null };
    const est = estimateRun(settings, [img, img], { ai: 0, bg: 0, bgAvailable: true });
    expect(est.bgRemovalCalls).toBe(2);
    expect(est.estimatedCostCents).toBe(0);
  });
  it("knows the bundled model specs", () => {
    expect(modelSpec("isnet").size).toBe(1024);
    expect(modelSpec("u2netp").size).toBe(320);
    expect(() => modelSpec("nope")).toThrow(/LOCAL_MODEL/);
  });
});
