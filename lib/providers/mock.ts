import sharp from "sharp";
import { ProviderError, type BackgroundRemovalProvider, type ImageEditProvider, type ImageEditRequest } from "./types";

/** Configurable via MOCK_FAIL_RATE (default 0.1) and MOCK_DELAY_MS ("min-max", default "1000-3000"). */
function mockConfig() {
  const failRate = Number(process.env.MOCK_FAIL_RATE ?? "0.1");
  const [min, max] = (process.env.MOCK_DELAY_MS ?? "1000-3000").split("-").map(Number);
  return { failRate: Number.isFinite(failRate) ? failRate : 0.1, min: min || 0, max: max || min || 0 };
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new ProviderError("timeout", "aborted"));
    });
  });
}

/** Zero-cost provider for development: returns a tinted copy after 1–3 s and fails ~10% of the time. */
export class MockImageEditProvider implements ImageEditProvider {
  readonly name = "mock";
  calls = 0;
  async edit(req: ImageEditRequest): Promise<Buffer> {
    this.calls++;
    const { failRate, min, max } = mockConfig();
    await sleep(min + Math.random() * Math.max(0, max - min), req.signal);
    if (Math.random() < failRate) {
      const kinds = ["server", "timeout", "rate_limit"] as const;
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      throw new ProviderError(kind, "mock failure", kind === "rate_limit" ? 1000 : undefined);
    }
    return sharp(req.image).tint({ r: 235, g: 225, b: 255 }).png().toBuffer();
  }
  async testConnection() {}
}

export class MockBackgroundRemovalProvider implements BackgroundRemovalProvider {
  readonly name = "mock-bg";
  async removeToWhite(image: Buffer): Promise<Buffer> {
    return sharp(image).flatten({ background: "#ffffff" }).png().toBuffer();
  }
  async testConnection() {}
}
