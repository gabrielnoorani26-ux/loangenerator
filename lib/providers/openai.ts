/**
 * OpenAI image-edit provider (POST /v1/images/edits via the official SDK).
 *
 * Checked against openai@7 typings (ImageEditParams): GPT image models accept
 * PNG/WEBP/JPG < 50 MB, always return base64; `input_fidelity` is only for
 * gpt-image-1 / 1.5 (omit for gpt-image-2+); gpt-image-2+ accept arbitrary
 * WIDTHxHEIGHT sizes (multiples of 16, aspect 1:3..3:1, max 3840x2160).
 * The model id always comes from IMAGE_PROVIDER_MODEL.
 */
import OpenAI, { toFile } from "openai";
import { env } from "../env";
import { errorFromStatus, ProviderError, toProviderError, type ImageEditProvider, type ImageEditRequest } from "./types";

type Quality = "low" | "medium" | "high" | "xhigh" | "max" | "auto";

/** Choose an output size close to the input's aspect ratio. Exported for tests. */
export function chooseSize(model: string, width: number, height: number): string {
  const legacy = /^gpt-image-1/.test(model) || model === "chatgpt-image-latest";
  const ratio = width / height;
  if (legacy) {
    if (ratio > 1.2) return "1536x1024";
    if (ratio < 1 / 1.2) return "1024x1536";
    return "1024x1024";
  }
  const clamped = Math.min(3, Math.max(1 / 3, ratio));
  // Stay at or below 2048 on the long edge: larger sizes are documented as experimental.
  const longest = Math.min(2048, Math.max(width, height));
  let w = clamped >= 1 ? longest : longest * clamped;
  let h = clamped >= 1 ? longest / clamped : longest;
  const round16 = (n: number) => Math.max(256, Math.round(n / 16) * 16);
  w = round16(w);
  h = round16(h);
  return `${w}x${h}`;
}

export class OpenAIImageEditProvider implements ImageEditProvider {
  readonly name = "openai";
  private client: OpenAI;
  constructor(
    apiKey = env.imageProviderApiKey,
    private readonly model = env.imageProviderModel,
  ) {
    if (!apiKey) throw new ProviderError("not_configured");
    if (!model) throw new ProviderError("bad_request", "IMAGE_PROVIDER_MODEL is not set");
    // Retries are handled by our job queue (with backoff + Retry-After), not the SDK.
    this.client = new OpenAI({ apiKey, maxRetries: 0, timeout: 300_000 });
  }

  async edit(req: ImageEditRequest): Promise<Buffer> {
    const ext = req.mime === "image/png" ? "png" : "jpg";
    try {
      const fidelity = env.openaiInputFidelity;
      const res = await this.client.images.edit(
        {
          model: this.model,
          image: await toFile(req.image, `source.${ext}`, { type: req.mime }),
          prompt: req.prompt,
          n: 1,
          size: chooseSize(this.model, req.width, req.height),
          quality: env.openaiImageQuality as Quality,
          output_format: "png",
          ...(fidelity === "high" || fidelity === "low" ? { input_fidelity: fidelity } : {}),
        },
        { signal: req.signal },
      );
      const b64 = res.data?.[0]?.b64_json;
      if (!b64) throw new ProviderError("unknown", "No image returned");
      return Buffer.from(b64, "base64");
    } catch (err) {
      throw mapOpenAIError(err);
    }
  }

  async testConnection(): Promise<void> {
    try {
      await this.client.models.retrieve(this.model);
    } catch (err) {
      throw mapOpenAIError(err);
    }
  }
}

function mapOpenAIError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err instanceof OpenAI.APIConnectionTimeoutError) return new ProviderError("timeout");
  if (err instanceof OpenAI.APIConnectionError) return new ProviderError("network", err.message);
  if (err instanceof OpenAI.APIError) {
    const code = err.code ?? "";
    if (code === "moderation_blocked" || code === "content_policy_violation") return new ProviderError("content_policy", err.message, undefined, err.status);
    return errorFromStatus(err.status ?? 0, err.message, err.headers?.get?.("retry-after") ?? null);
  }
  return toProviderError(err);
}
