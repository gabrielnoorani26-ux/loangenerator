import { describe, expect, it } from "vitest";
import { parseFilename } from "@/lib/smart-fill";

describe("parseFilename", () => {
  it("parses the canonical style_color_view pattern", () => {
    expect(parseFilename("CC2045_black_side.jpg")).toEqual({
      styleCode: "CC2045",
      colorName: "black",
      viewAngle: "SIDE",
    });
  });
  it("splits on hyphens too", () => {
    expect(parseFilename("CC2045-tan-front.png")).toEqual({
      styleCode: "CC2045",
      colorName: "tan",
      viewAngle: "FRONT",
    });
  });
  it("handles multi-word colors and trailing sequence numbers", () => {
    expect(parseFilename("ar1001_light_blue_pair_02.JPG")).toEqual({
      styleCode: "AR1001",
      colorName: "light blue",
      viewAngle: "PAIR",
    });
  });
  it("joins a letter prefix and number into one style code", () => {
    expect(parseFilename("AR-1001-black-sole.jpg")).toEqual({
      styleCode: "AR-1001",
      colorName: "black",
      viewAngle: "SOLE",
    });
  });
  it("maps view synonyms", () => {
    expect(parseFilename("CC1_red_rear.jpg").viewAngle).toBe("BACK");
    expect(parseFilename("CC1_red_bottom.jpg").viewAngle).toBe("SOLE");
    expect(parseFilename("CC1_red_closeup.jpg").viewAngle).toBe("DETAIL");
    expect(parseFilename("CC1_red_lifestyle.jpg").viewAngle).toBe("LIFESTYLE");
    expect(parseFilename("CC1_red_overhead.jpg").viewAngle).toBe("TOP");
  });
  it("returns nulls for parts that are missing", () => {
    expect(parseFilename("CC2045.jpg")).toEqual({ styleCode: "CC2045", colorName: null, viewAngle: null });
    expect(parseFilename("side.jpg")).toEqual({ styleCode: null, colorName: null, viewAngle: "SIDE" });
  });
  it("uses the first token as style when no token has digits", () => {
    expect(parseFilename("boot_black_side.jpg")).toEqual({ styleCode: "BOOT", colorName: "black", viewAngle: "SIDE" });
  });
  it("ignores camera prefixes and paths", () => {
    expect(parseFilename("some/dir/CC77_white_IMG_0042.heic")).toEqual({
      styleCode: "CC77",
      colorName: "white",
      viewAngle: null,
    });
  });
  it("handles empty names", () => {
    expect(parseFilename(".jpg")).toEqual({ styleCode: null, colorName: null, viewAngle: null });
  });
});
