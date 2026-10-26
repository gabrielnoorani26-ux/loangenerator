/**
 * Server-side environment access. Never import this from client components:
 * it reads API keys.
 */
import path from "node:path";

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  get storageDir(): string {
    return path.resolve(process.cwd(), process.env.STORAGE_DIR || "./storage");
  },
  get imageProvider(): string {
    return (process.env.IMAGE_PROVIDER || "mock").toLowerCase();
  },
  get imageProviderApiKey(): string {
    return process.env.IMAGE_PROVIDER_API_KEY || "";
  },
  get imageProviderModel(): string {
    return process.env.IMAGE_PROVIDER_MODEL || "";
  },
  get openaiImageQuality(): string {
    return process.env.OPENAI_IMAGE_QUALITY || "high";
  },
  get openaiInputFidelity(): string {
    return process.env.OPENAI_INPUT_FIDELITY || "";
  },
  get bgRemovalProvider(): string {
    return (process.env.BG_REMOVAL_PROVIDER || "").toLowerCase();
  },
  get bgRemovalApiKey(): string {
    return process.env.BG_REMOVAL_API_KEY || "";
  },
  get anthropicApiKey(): string {
    return process.env.ANTHROPIC_API_KEY || "";
  },
  get anthropicQcModel(): string {
    return process.env.ANTHROPIC_QC_MODEL || "";
  },
  get aiCostPerCallCents(): number {
    return int("AI_COST_PER_CALL_CENTS", 8);
  },
  get bgRemovalCostPerCallCents(): number {
    return int("BG_REMOVAL_COST_PER_CALL_CENTS", 2);
  },
  get maxConcurrentAiCalls(): number {
    return int("MAX_CONCURRENT_AI_CALLS", 3);
  },
  get maxRetries(): number {
    return int("MAX_RETRIES", 2);
  },
  get maxUploadMb(): number {
    return int("MAX_UPLOAD_MB", 25);
  },
};
