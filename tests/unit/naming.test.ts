import { describe, expect, it } from "vitest";
import { renderPattern, sanitizeFilenamePart, uniqueFilename, type NamingContext } from "@/lib/naming";

const ctx: NamingContext = {
  originalFilename: "IMG_0042.JPG",
  batchName: "Spring Drop 2026",
  brand: "Chelsea Crew",
  styleCode: "CC2045",
  colorName: "black",
  viewAngle: "SIDE",
  index: 7,
  date: new Date(2026, 9, 26),
  width: 2000,
  height: 1500,
};

describe("renderPattern", () => {
  it("replaces every token", () => {
    expect(renderPattern("{original}|{batch}|{brand}|{style}|{color}|{view}|{index}|{date}|{width}|{height}", ctx)).toBe(
      "IMG_0042_Spring_Drop_2026_Chelsea_Crew_CC2045_black_side_007_20261026_2000_1500",
    );
  });
  it("zero-pads index to 3 digits", () => {
    expect(renderPattern("{index}", { ...ctx, index: 1 })).toBe("001");
    expect(renderPattern("{index}", { ...ctx, index: 123 })).toBe("123");
    expect(renderPattern("{index}", { ...ctx, index: 1234 })).toBe("1234");
  });
  it("collapses separators left by empty tokens", () => {
    expect(renderPattern("{style}_{color}_{view}", { ...ctx, colorName: null })).toBe("CC2045_side");
    expect(renderPattern("{style}-{color}-{view}", { ...ctx, styleCode: null, viewAngle: null })).toBe("black");
  });
  it("falls back to the original name when everything is empty", () => {
    expect(renderPattern("{style}_{color}", { ...ctx, styleCode: null, colorName: null })).toBe("IMG_0042");
  });
  it("sanitizes unsafe characters and path separators", () => {
    expect(renderPattern("{color}", { ...ctx, colorName: "../../etc/passwd" })).toBe("etc_passwd");
    expect(renderPattern("{brand}", { ...ctx, brand: 'A:B*C?"<>|' })).toBe("A_B_C");
    expect(renderPattern("{color}", { ...ctx, colorName: "Crème brûlée" })).toBe("Creme_brulee");
  });
  it("keeps literal text and unknown tokens are made safe", () => {
    expect(renderPattern("shoe-{style}", ctx)).toBe("shoe-CC2045");
    expect(renderPattern("{nope}_{style}", ctx)).toBe("nope_CC2045");
  });
  it("avoids Windows reserved names", () => {
    expect(renderPattern("CON", ctx)).toBe("CON_");
  });
  it("limits length", () => {
    expect(renderPattern("{original}", { ...ctx, originalFilename: "a".repeat(400) + ".jpg" }).length).toBeLessThanOrEqual(150);
  });
});

describe("uniqueFilename", () => {
  it("de-duplicates case-insensitively with _2, _3", () => {
    const taken = new Set<string>();
    expect(uniqueFilename("CC2045_black", "jpg", taken)).toBe("CC2045_black.jpg");
    expect(uniqueFilename("CC2045_black", "jpg", taken)).toBe("CC2045_black_2.jpg");
    expect(uniqueFilename("cc2045_BLACK", "jpg", taken)).toBe("cc2045_BLACK_3.jpg");
    expect(uniqueFilename("CC2045_black", "png", taken)).toBe("CC2045_black.png");
  });
});

describe("sanitizeFilenamePart", () => {
  it("trims leading/trailing separators and dots", () => {
    expect(sanitizeFilenamePart("..hidden..")).toBe("hidden");
    expect(sanitizeFilenamePart("  spaced  out ")).toBe("spaced_out");
  });
});
