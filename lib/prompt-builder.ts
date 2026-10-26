/**
 * Builds the single combined AI prompt for an image. Every prompt is wrapped
 * in the Product Preservation Rule (spec §4). Pure; safe to import on the client.
 */
import { SCENE_PRESETS, type AiSettings } from "./settings";

export const PRESERVATION_HEADER =
  "You are editing a professional product photograph. Preserve the product exactly as it appears: identical shape, silhouette, color, material texture, stitching, hardware, buckles, laces, soles, logos, branding, proportions, and angle. Do not add, remove, redesign, or reinterpret any part of the product. Do not change the camera angle or crop the product. Only make the following changes:";

export const PRESERVATION_FOOTER =
  "The final image must look like a real, professionally shot photograph, not an illustration or render.";

const SHADOW_LINES: Record<Exclude<AiSettings["shadow"], "none">, string> = {
  soft: "Add a soft, natural drop shadow beneath the product, consistent with diffuse studio lighting.",
  contact: "Add only a subtle contact shadow where the product touches the ground; no cast shadow.",
  reflection: "Add a subtle, realistic reflection of the product on a glossy surface beneath it.",
};

const LIGHTING_PARTS: Record<keyof AiSettings["lighting"], string> = {
  whiteBalance: "fix the white balance so neutral tones are neutral",
  brighten: "brighten the image evenly",
  recoverShadows: "recover detail in the shadows",
  reduceHighlights: "reduce harsh highlights and glare",
  trueColors: "render true-to-life colors",
};

const CLEANUP_PARTS: Record<keyof AiSettings["cleanup"], string> = {
  dust: "dust and lint",
  scuffs: "minor scuffs and creases",
  threads: "stray threads",
  tags: "price tags and stickers",
  props: "props, hands, and mannequin parts",
  watermarkText: "watermark text",
};

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/** The numbered change lines, in a fixed order. Exported for tests and the UI. */
export function buildChangeLines(ai: AiSettings, perImageInstruction?: string | null): string[] {
  const lines: string[] = [];
  const bg = ai.background;
  if (bg.mode === "solid") {
    lines.push(
      `Replace the entire background with a seamless, solid ${bg.color.toUpperCase()} background with no gradient, texture, or visible edges.`,
    );
  } else if (bg.mode === "scene") {
    const scene = bg.scenePreset === "custom" ? bg.customScene.trim() : SCENE_PRESETS[bg.scenePreset];
    if (scene) {
      lines.push(
        `Replace the background with: ${scene}. Match the lighting direction and color temperature on the product to the new scene naturally.`,
      );
    }
  }
  if (ai.shadow !== "none") lines.push(SHADOW_LINES[ai.shadow]);

  const lighting = (Object.keys(LIGHTING_PARTS) as (keyof typeof LIGHTING_PARTS)[]).filter((k) => ai.lighting[k]);
  if (lighting.length) {
    const text = joinList(lighting.map((k) => LIGHTING_PARTS[k]));
    lines.push(`${text.charAt(0).toUpperCase()}${text.slice(1)}. Do not alter the product's actual colors.`);
  }

  const cleanup = (Object.keys(CLEANUP_PARTS) as (keyof typeof CLEANUP_PARTS)[]).filter((k) => ai.cleanup[k]);
  if (cleanup.length) {
    lines.push(`Remove ${joinList(cleanup.map((k) => CLEANUP_PARTS[k]))}, without altering the product itself.`);
  }

  if (ai.straighten) {
    lines.push("Center the product in the frame and level it so it sits straight, without changing its angle or proportions.");
  }
  const custom = ai.customInstruction.trim().slice(0, 500);
  if (custom) lines.push(ensurePeriod(custom));
  const perImage = perImageInstruction?.trim().slice(0, 500);
  if (perImage) lines.push(ensurePeriod(perImage));
  return lines;
}

function ensurePeriod(s: string): string {
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

/** Full prompt, or null when there is nothing for the AI to do. */
export function buildPrompt(ai: AiSettings, perImageInstruction?: string | null): string | null {
  const lines = buildChangeLines(ai, perImageInstruction);
  if (lines.length === 0) return null;
  return [PRESERVATION_HEADER, ...lines.map((l, i) => `${i + 1}. ${l}`), PRESERVATION_FOOTER].join("\n");
}
