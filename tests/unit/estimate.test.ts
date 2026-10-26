import { describe, expect, it } from "vitest";
import { estimateRun } from "@/lib/estimate";
import { aiSettingsHash } from "@/lib/ai-hash";
import { EditSettingsSchema } from "@/lib/settings";

const prices = { ai: 10, bg: 2, bgAvailable: false };
const img = (o: object = {}) => ({
  useOriginal: false,
  perImageInstruction: null,
  aiSettingsHash: null,
  aiIntermediateKey: null,
  ...o,
});

describe("estimateRun", () => {
  const withAi = EditSettingsSchema.parse({ ai: { background: { mode: "solid" }, shadow: "soft" } });
  it("charges nothing without AI edits", () => {
    const e = estimateRun(EditSettingsSchema.parse({}), [img(), img()], prices);
    expect(e).toMatchObject({ aiCalls: 0, estimatedCostCents: 0 });
  });
  it("counts per-image instructions as AI work even without batch AI edits", () => {
    const e = estimateRun(EditSettingsSchema.parse({}), [img({ perImageInstruction: "fix glare" }), img()], prices);
    expect(e.aiCalls).toBe(1);
  });
  it("skips use-original images and cache hits", () => {
    const hash = aiSettingsHash(withAi.ai)!;
    const e = estimateRun(
      withAi,
      [
        img(),
        img({ useOriginal: true }),
        img({ aiSettingsHash: hash, aiIntermediateKey: "k" }),
        img({ aiSettingsHash: "stale", aiIntermediateKey: "k" }),
      ],
      prices,
    );
    expect(e).toMatchObject({ aiCalls: 2, skippedOriginal: 1, cacheHits: 1, estimatedCostCents: 20 });
  });
  it("routes white-background-only to the cheaper provider when available", () => {
    const white = EditSettingsSchema.parse({ ai: { background: { mode: "solid", color: "#ffffff" } } });
    const e = estimateRun(white, [img(), img()], { ...prices, bgAvailable: true });
    expect(e).toMatchObject({ aiCalls: 0, bgRemovalCalls: 2, estimatedCostCents: 4 });
    const e2 = estimateRun(white, [img({ perImageInstruction: "x" })], { ...prices, bgAvailable: true });
    expect(e2).toMatchObject({ aiCalls: 1, bgRemovalCalls: 0 });
  });
  it("standard-only setting changes keep the AI hash stable", () => {
    const a = EditSettingsSchema.parse({ ai: { background: { mode: "solid" } }, standard: { fit: { enabled: true } } });
    const b = EditSettingsSchema.parse({
      ai: { background: { mode: "solid", scenePreset: "marble" } },
      output: { format: "png" },
    });
    expect(aiSettingsHash(a.ai)).toBe(aiSettingsHash(b.ai));
    expect(aiSettingsHash(a.ai, "extra")).not.toBe(aiSettingsHash(a.ai));
  });
});
