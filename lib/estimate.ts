import { aiSettingsHash } from "./ai-hash";
import { env } from "./env";
import { imageNeedsAi, isPureWhiteBackgroundOnly, type EditSettings } from "./settings";

export interface EstimateImage {
  useOriginal: boolean;
  perImageInstruction: string | null;
  aiSettingsHash: string | null;
  aiIntermediateKey: string | null;
}

export interface Estimate {
  images: number;
  aiCalls: number;
  bgRemovalCalls: number;
  cacheHits: number;
  skippedOriginal: number;
  estimatedCostCents: number;
}

export function bgRemovalAvailable(): boolean {
  const name = env.bgRemovalProvider || (env.localMode ? "local" : "");
  return name === "mock" || name === "local" || Boolean(name && env.bgRemovalApiKey);
}

/** Count the API calls a run would make, accounting for cache hits and use-original. */
export function estimateRun(
  settings: EditSettings,
  images: EstimateImage[],
  prices = { ai: env.aiCostPerCallCents, bg: env.bgRemovalCostPerCallCents, bgAvailable: bgRemovalAvailable() },
): Estimate {
  let aiCalls = 0;
  let bgRemovalCalls = 0;
  let cacheHits = 0;
  let skippedOriginal = 0;
  for (const img of images) {
    if (img.useOriginal) {
      skippedOriginal++;
      continue;
    }
    if (!imageNeedsAi(settings.ai, img)) continue;
    const hash = aiSettingsHash(settings.ai, img.perImageInstruction);
    if (hash && img.aiIntermediateKey && img.aiSettingsHash === hash) {
      cacheHits++;
      continue;
    }
    if (prices.bgAvailable && isPureWhiteBackgroundOnly(settings.ai, img.perImageInstruction)) bgRemovalCalls++;
    else aiCalls++;
  }
  return {
    images: images.length,
    aiCalls,
    bgRemovalCalls,
    cacheHits,
    skippedOriginal,
    estimatedCostCents: aiCalls * prices.ai + bgRemovalCalls * prices.bg,
  };
}
