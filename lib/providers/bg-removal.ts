/**
 * Dedicated background-removal providers. Photoroom's /v1/segment is
 * documented as remove.bg-compatible (same multipart fields), so one
 * implementation serves both:
 *   photoroom: POST https://sdk.photoroom.com/v1/segment   header x-api-key
 *   removebg:  POST https://api.remove.bg/v1.0/removebg     header X-Api-Key
 * Fields: image_file, bg_color (hex without #), format, size.
 */
import sharp from "sharp";
import { errorFromStatus, ProviderError, toProviderError, type BackgroundRemovalProvider } from "./types";

const ENDPOINTS = {
  photoroom: { url: "https://sdk.photoroom.com/v1/segment", header: "x-api-key" },
  removebg: { url: "https://api.remove.bg/v1.0/removebg", header: "X-Api-Key" },
} as const;
export type BgProviderName = keyof typeof ENDPOINTS;

export class HttpBackgroundRemovalProvider implements BackgroundRemovalProvider {
  constructor(
    readonly name: BgProviderName,
    private readonly apiKey: string,
  ) {
    if (!apiKey) throw new ProviderError("not_configured");
  }

  async removeToWhite(image: Buffer, signal?: AbortSignal): Promise<Buffer> {
    const ep = ENDPOINTS[this.name];
    const form = new FormData();
    const png = await sharp(image).png().toBuffer();
    form.append("image_file", new Blob([new Uint8Array(png)], { type: "image/png" }), "image.png");
    form.append("bg_color", "FFFFFF");
    form.append("format", "png");
    if (this.name === "removebg") form.append("size", "auto");
    let res: Response;
    try {
      res = await fetch(ep.url, {
        method: "POST",
        headers: { [ep.header]: this.apiKey },
        body: form,
        signal: signal ?? AbortSignal.timeout(120_000),
      });
    } catch (err) {
      throw toProviderError(err);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw errorFromStatus(res.status, text.slice(0, 300), res.headers.get("retry-after"));
    }
    const out = Buffer.from(await res.arrayBuffer());
    // Guarantee an opaque white background even if the API returned alpha.
    return sharp(out).flatten({ background: "#ffffff" }).png().toBuffer();
  }

  async testConnection(): Promise<void> {
    // Neither API has a free "ping"; a 1×1 request is the cheapest authenticated call.
    // Photoroom's sandbox keys and remove.bg previews make this negligible.
    const px = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#888" } }).png().toBuffer();
    await this.removeToWhite(px);
  }
}
