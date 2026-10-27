/**
 * Local mode: edits run on this machine with an open-source segmentation
 * model + sharp. No API keys, no network after the one-time model download,
 * no per-image cost. See lib/local/edits.ts for what each option does.
 */
import sharp from "sharp";
import { localEdit } from "../local/edits";
import { segment, warmUp } from "../local/segment";
import { AiSettingsSchema } from "../settings";
import {
  ProviderError,
  toProviderError,
  type BackgroundRemovalProvider,
  type ImageEditProvider,
  type ImageEditRequest,
} from "./types";

const WHITE_BG = AiSettingsSchema.parse({ background: { mode: "solid", color: "#FFFFFF" } });

export class LocalImageEditProvider implements ImageEditProvider {
  readonly name = "local";
  async edit(req: ImageEditRequest): Promise<Buffer> {
    if (!req.ai) throw new ProviderError("bad_request", "local mode needs the structured AI settings");
    try {
      return await localEdit(req.image, { ai: req.ai, segment });
    } catch (err) {
      throw toProviderError(err);
    }
  }
  /** "Connection" = the model is downloaded and loads. */
  async testConnection() {
    await warmUp();
  }
}

export class LocalBackgroundRemovalProvider implements BackgroundRemovalProvider {
  readonly name = "local";
  async removeToWhite(image: Buffer): Promise<Buffer> {
    try {
      const out = await localEdit(image, { ai: WHITE_BG, segment });
      return sharp(out).flatten({ background: "#ffffff" }).png().toBuffer();
    } catch (err) {
      throw toProviderError(err);
    }
  }
  async testConnection() {
    await warmUp();
  }
}
