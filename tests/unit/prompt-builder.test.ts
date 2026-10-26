import { describe, expect, it } from "vitest";
import { buildChangeLines, buildPrompt, PRESERVATION_FOOTER, PRESERVATION_HEADER } from "@/lib/prompt-builder";
import { AiSettingsSchema, EditSettingsSchema, type AiSettings } from "@/lib/settings";

const ai = (over: object = {}): AiSettings => AiSettingsSchema.parse(over);

describe("buildPrompt", () => {
  it("returns null when no AI edits are enabled", () => {
    expect(buildPrompt(ai())).toBeNull();
    expect(buildPrompt(ai(), "   ")).toBeNull();
  });

  it("wraps changes in the product preservation rule with numbered lines", () => {
    const p = buildPrompt(ai({ background: { mode: "solid" } }))!;
    expect(p.startsWith(PRESERVATION_HEADER)).toBe(true);
    expect(p.endsWith(PRESERVATION_FOOTER)).toBe(true);
    expect(p).toContain(
      "\n1. Replace the entire background with a seamless, solid #FFFFFF background with no gradient, texture, or visible edges.",
    );
    expect(p).not.toContain("\n2.");
  });

  it("background: solid color uses the chosen color", () => {
    expect(buildChangeLines(ai({ background: { mode: "solid", color: "#f5f5dc" } }))[0]).toContain(
      "solid #F5F5DC background",
    );
  });

  it("background: scene presets and custom scenes", () => {
    const preset = buildChangeLines(ai({ background: { mode: "scene", scenePreset: "marble" } }))[0];
    expect(preset).toMatch(/^Replace the background with: a polished white marble surface/);
    expect(preset).toContain(
      "Match the lighting direction and color temperature on the product to the new scene naturally.",
    );
    const custom = buildChangeLines(
      ai({ background: { mode: "scene", scenePreset: "custom", customScene: "a red velvet cushion" } }),
    )[0];
    expect(custom).toContain("Replace the background with: a red velvet cushion.");
  });

  it("background modes are mutually exclusive (single enum)", () => {
    const lines = buildChangeLines(ai({ background: { mode: "scene", scenePreset: "pastel", color: "#000000" } }));
    expect(lines.filter((l) => l.includes("background")).length).toBe(1);
    expect(lines[0]).not.toContain("#000000");
  });

  it("rejects an empty custom scene in the schema", () => {
    expect(
      AiSettingsSchema.safeParse({ background: { mode: "scene", scenePreset: "custom", customScene: "" } }).success,
    ).toBe(false);
  });

  it("shadow options", () => {
    expect(buildChangeLines(ai({ shadow: "soft" }))[0]).toMatch(/soft, natural drop shadow/);
    expect(buildChangeLines(ai({ shadow: "contact" }))[0]).toMatch(/contact shadow/);
    expect(buildChangeLines(ai({ shadow: "reflection" }))[0]).toMatch(/reflection/);
    expect(buildChangeLines(ai({ shadow: "none" }))).toEqual([]);
  });

  it("lighting combines checked options and always protects product colors", () => {
    const one = buildChangeLines(ai({ lighting: { whiteBalance: true } }));
    expect(one).toEqual([
      "Fix the white balance so neutral tones are neutral. Do not alter the product's actual colors.",
    ]);
    const all = buildChangeLines(
      ai({
        lighting: {
          whiteBalance: true,
          brighten: true,
          recoverShadows: true,
          reduceHighlights: true,
          trueColors: true,
        },
      }),
    );
    expect(all).toHaveLength(1);
    expect(all[0]).toContain("brighten the image evenly");
    expect(all[0]).toContain(", and render true-to-life colors");
    expect(all[0].endsWith("Do not alter the product's actual colors.")).toBe(true);
  });

  it("cleanup combines checked options into one line", () => {
    const l = buildChangeLines(ai({ cleanup: { dust: true, tags: true, props: true } }));
    expect(l).toEqual([
      "Remove dust and lint, price tags and stickers, and props, hands, and mannequin parts, without altering the product itself.",
    ]);
    expect(buildChangeLines(ai({ cleanup: { watermarkText: true } }))[0]).toContain("watermark text");
    expect(buildChangeLines(ai({ cleanup: { scuffs: true, threads: true } }))[0]).toContain(
      "minor scuffs and creases and stray threads",
    );
  });

  it("straighten & center", () => {
    expect(buildChangeLines(ai({ straighten: true }))).toEqual([
      "Center the product in the frame and level it so it sits straight, without changing its angle or proportions.",
    ]);
  });

  it("custom instruction (max 500) and per-image instruction come last, in that order", () => {
    const lines = buildChangeLines(
      ai({ background: { mode: "solid" }, customInstruction: "Make laces bright white" }),
      "remove the left shoe's tag",
    );
    expect(lines.at(-2)).toBe("Make laces bright white.");
    expect(lines.at(-1)).toBe("remove the left shoe's tag.");
    expect(AiSettingsSchema.safeParse({ customInstruction: "x".repeat(501) }).success).toBe(false);
  });

  it("per-image instruction alone produces a prompt", () => {
    expect(buildPrompt(ai(), "Fix the glare on the toe")).toContain("1. Fix the glare on the toe.");
  });

  it("orders every category consistently in a full combination", () => {
    const p = buildPrompt(
      ai({
        background: { mode: "solid" },
        shadow: "soft",
        lighting: { whiteBalance: true },
        cleanup: { dust: true },
        straighten: true,
        customInstruction: "Keep it crisp",
      }),
      "Extra fix",
    )!;
    const order = [
      "1. Replace the entire background",
      "2. Add a soft",
      "3. Fix the white balance",
      "4. Remove dust",
      "5. Center the product",
      "6. Keep it crisp",
      "7. Extra fix",
    ];
    let last = -1;
    for (const o of order) {
      const i = p.indexOf(o);
      expect(i).toBeGreaterThan(last);
      last = i;
    }
  });

  it("works for every seeded preset", async () => {
    const { PRESET_SEEDS } = await import("@/lib/preset-seeds");
    for (const seed of PRESET_SEEDS) {
      const s = EditSettingsSchema.parse(seed.settings);
      const p = buildPrompt(s.ai);
      if (seed.name.includes("No AI")) expect(p).toBeNull();
      else expect(p).toContain(PRESERVATION_HEADER);
    }
  });
});
