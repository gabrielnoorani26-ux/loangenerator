import type { StandardSettings } from "./settings";
import { sanitizeKey, storage } from "./storage";

/** Load the logo buffer referenced by watermark settings (null if not needed / missing). */
export async function loadWatermarkAssets(wm: StandardSettings["watermark"]): Promise<{ logo: Buffer | null }> {
  if (!wm.enabled || wm.type !== "logo" || !wm.logoKey) return { logo: null };
  const key = sanitizeKey(wm.logoKey);
  if (!key || !key.startsWith("watermarks/")) return { logo: null };
  try {
    return { logo: await storage().get(key) };
  } catch {
    return { logo: null };
  }
}
