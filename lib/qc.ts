/**
 * Automated QC: compare the original and edited images with a vision model and
 * flag likely product alterations. QC failures never fail the image.
 */
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { z } from "zod";
import { env } from "./env";
import { maskBox } from "./local/edits";
import { segment as localSegment, warmUp, type Segmenter } from "./local/segment";

export const QC_INSTRUCTION =
  'Compare these two product photos. The first is the original, the second is the edited version. Check whether the product itself was altered in any way (shape, color, details, logos, hardware, stitching, missing or extra parts) and whether the requested edits were done cleanly (no artifacts, leftover background, halos, or distortions). Respond with only JSON: {"score": 0-100, "issues": [short strings], "verdict": "pass" | "review"}. 100 means the product is perfectly preserved and edits are clean.';

export const QcResultSchema = z.object({
  score: z
    .number()
    .min(0)
    .max(100)
    .transform((n) => Math.round(n)),
  issues: z.array(z.string().max(300)).max(20).default([]),
  verdict: z.enum(["pass", "review"]),
});
export type QcResult = z.infer<typeof QcResultSchema>;

export const QC_UNAVAILABLE: QcResult = { score: 0, issues: ["QC could not be completed"], verdict: "review" };

export interface QcProvider {
  readonly name: string;
  /** Returns raw model text; parsing/validation happens in runQc. */
  compare(originalJpeg: Buffer, editedJpeg: Buffer): Promise<string>;
  testConnection(): Promise<void>;
}

/** Downscale to a ≤1024px JPEG to keep vision tokens low. */
export async function toQcJpeg(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 82 })
    .toBuffer();
}

/** Extract and validate the JSON object from a model reply. Returns null if invalid. */
export function parseQcResponse(text: string): QcResult | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = QcResultSchema.safeParse(JSON.parse(match[0]));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Run QC: one retry on unparseable output or API error, then fall back to
 * verdict "review". Images scoring below `threshold` are always "review".
 */
export async function runQc(
  provider: QcProvider,
  original: Buffer,
  edited: Buffer,
  threshold: number,
): Promise<QcResult> {
  let a: Buffer;
  let b: Buffer;
  try {
    [a, b] = await Promise.all([toQcJpeg(original), toQcJpeg(edited)]);
  } catch {
    return QC_UNAVAILABLE;
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = parseQcResponse(await provider.compare(a, b));
      if (result) return result.score < threshold ? { ...result, verdict: "review" } : result;
    } catch (err) {
      console.warn(`[qc] attempt ${attempt + 1} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return QC_UNAVAILABLE;
}

// Models that accept the server-side refusal fallback ("default" routing).
const FALLBACK_MODELS = /^claude-(fable-5-1|opus-5-5|opus-5|sonnet-5-5)$/;

export class AnthropicQcProvider implements QcProvider {
  readonly name = "anthropic";
  private client: Anthropic;
  constructor(
    apiKey = env.anthropicApiKey,
    private readonly model = env.anthropicQcModel,
    /** Injectable for tests */
    fetchImpl?: typeof fetch,
  ) {
    if (!model) throw new Error("ANTHROPIC_QC_MODEL is not set");
    this.client = new Anthropic({
      apiKey,
      maxRetries: 2,
      timeout: 120_000,
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    });
  }

  async compare(originalJpeg: Buffer, editedJpeg: Buffer): Promise<string> {
    const useFallback = FALLBACK_MODELS.test(this.model);
    const res = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 2000,
      // A short structured judgement: low effort keeps cost and latency down.
      output_config: { effort: "low" },
      ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Image 1 (original):" },
            {
              type: "image",
              source: { type: "base64", media_type: "image/jpeg", data: originalJpeg.toString("base64") },
            },
            { type: "text", text: "Image 2 (edited):" },
            {
              type: "image",
              source: { type: "base64", media_type: "image/jpeg", data: editedJpeg.toString("base64") },
            },
            { type: "text", text: QC_INSTRUCTION },
          ],
        },
      ],
    });
    if (res.stop_reason === "refusal") throw new Error("QC request was declined by the model");
    return res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  }

  async testConnection(): Promise<void> {
    await this.client.models.retrieve(this.model);
  }
}

/**
 * Mock QC for IMAGE_PROVIDER=mock: deterministic-ish score from pixel
 * difference so "altered" images really do score lower.
 */
export class MockQcProvider implements QcProvider {
  readonly name = "mock";
  async compare(originalJpeg: Buffer, editedJpeg: Buffer): Promise<string> {
    const size = 64;
    const [a, b] = await Promise.all(
      [originalJpeg, editedJpeg].map((x) =>
        sharp(x).resize(size, size, { fit: "fill" }).removeAlpha().raw().toBuffer(),
      ),
    );
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
    const meanDiff = diff / a.length; // 0..255
    const score = Math.max(0, Math.min(100, Math.round(100 - meanDiff * 1.2)));
    const issues = score < 85 ? ["Noticeable color/shape difference from the original"] : [];
    return JSON.stringify({ score, issues, verdict: score >= 70 ? "pass" : "review" });
  }
  async testConnection() {}
}

/**
 * Offline QC for local mode: segments both images, normalizes each product
 * cut-out to its bounding box (so centering doesn't count as a change) and
 * scores silhouette overlap plus color drift inside the product.
 */
export class LocalQcProvider implements QcProvider {
  readonly name = "local";
  constructor(private readonly segment: Segmenter = localSegment) {}

  async compare(originalJpeg: Buffer, editedJpeg: Buffer): Promise<string> {
    const size = 96;
    const a = await this.productTile(originalJpeg, size);
    // A synthesized reflection is segmented as part of the product: cap the
    // edited box to the original's aspect ratio, anchored at the top.
    const b = a ? await this.productTile(editedJpeg, size, a.aspect) : null;
    if (!a || !b) {
      return JSON.stringify({ score: 0, issues: ["No product detected in one of the images"], verdict: "review" });
    }
    let inter = 0;
    let union = 0;
    let diff = 0;
    for (let i = 0; i < size * size; i++) {
      const ina = a.mask[i] >= 128;
      const inb = b.mask[i] >= 128;
      if (ina || inb) union++;
      if (ina && inb) {
        inter++;
        for (let c = 0; c < 3; c++) diff += Math.abs(a.rgb[i * 3 + c] - b.rgb[i * 3 + c]);
      }
    }
    const iou = union ? inter / union : 0;
    const meanDiff = inter ? diff / (inter * 3) : 255;
    // Some color drift is expected from lighting toggles; penalize beyond that.
    const score = Math.max(0, Math.min(100, Math.round(iou * 100 - Math.max(0, meanDiff - 12) * 1.5)));
    const issues: string[] = [];
    if (iou < 0.9) issues.push("Product outline differs from the original (possible cut-off or leftover background)");
    if (meanDiff > 25) issues.push("Product colors shifted noticeably");
    return JSON.stringify({ score, issues, verdict: score >= 80 ? "pass" : "review" });
  }

  private async productTile(jpeg: Buffer, size: number, maxAspect?: number) {
    const mask = await this.segment(jpeg);
    const box = maskBox(mask);
    if (!box) return null;
    const width = box.x1 - box.x0 + 1;
    let height = box.y1 - box.y0 + 1;
    if (maxAspect && height / width > maxAspect * 1.05) height = Math.max(1, Math.round(width * maxAspect));
    const region = { left: box.x0, top: box.y0, width, height };
    const [m, rgb] = await Promise.all([
      sharp(mask.data, { raw: { width: mask.width, height: mask.height, channels: 1 } })
        .extract(region)
        .resize(size, size, { fit: "fill" })
        .extractChannel(0)
        .raw()
        .toBuffer(),
      sharp(jpeg).removeAlpha().extract(region).resize(size, size, { fit: "fill" }).raw().toBuffer(),
    ]);
    return { mask: m, rgb, aspect: height / width };
  }

  async testConnection() {
    await warmUp();
  }
}

let qcProvider: QcProvider | null | undefined;
/** Anthropic when a key is set; local in local mode; mock when IMAGE_PROVIDER=mock; otherwise null (QC skipped). */
export function getQcProvider(): QcProvider | null {
  if (qcProvider !== undefined) return qcProvider;
  if (env.anthropicApiKey && env.anthropicQcModel) qcProvider = new AnthropicQcProvider();
  else if (env.localMode) qcProvider = new LocalQcProvider();
  else if (env.imageProvider === "mock") qcProvider = new MockQcProvider();
  else qcProvider = null;
  return qcProvider;
}
export function setQcProvider(p: QcProvider | null | undefined) {
  qcProvider = p;
}
