/**
 * EditSettings — the single source of truth for every AI and standard edit
 * option. Shared by client and server. Every settings JSON stored in the DB
 * (Batch.settings, Batch.settingsSnapshot, Preset.settings) must parse
 * against this schema.
 */
import { z } from "zod";

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const hexColor = z.string().regex(HEX_COLOR, "Must be a hex color like #FFFFFF");

export const SCENE_PRESETS = {
  studio_gray: "a seamless studio gray backdrop with soft, even studio lighting",
  marble: "a polished white marble surface with soft natural light",
  wood_floor: "a light natural wood floor with soft window light",
  concrete: "a smooth urban concrete surface with soft daylight",
  pavement: "an outdoor city pavement in soft overcast daylight",
  beach_sand: "smooth beach sand in warm late-afternoon sunlight",
  pastel: "a clean pastel-colored seamless paper backdrop",
  custom: "",
} as const;
export type ScenePreset = keyof typeof SCENE_PRESETS;
export const SCENE_PRESET_LABELS: Record<ScenePreset, string> = {
  studio_gray: "Studio Gray Seamless",
  marble: "Marble Surface",
  wood_floor: "Wood Floor",
  concrete: "Concrete Urban",
  pavement: "Outdoor Pavement",
  beach_sand: "Beach Sand",
  pastel: "Pastel Backdrop",
  custom: "Custom",
};

export const WATERMARK_POSITIONS = [
  "top-left",
  "top-center",
  "top-right",
  "middle-left",
  "center",
  "middle-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const;
export type WatermarkPosition = (typeof WATERMARK_POSITIONS)[number];

export const ASPECT_RATIOS = ["original", "1:1", "4:5", "3:4", "2:3", "16:9", "9:16", "custom"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

const adjustment = z.number().int().min(-100).max(100).default(0);

export const AiSettingsSchema = z
  .object({
    background: z
      .object({
        // A single mode enum makes "solid color" and "custom scene" mutually exclusive.
        mode: z.enum(["none", "solid", "scene"]).default("none"),
        color: hexColor.default("#FFFFFF"),
        scenePreset: z
          .enum(Object.keys(SCENE_PRESETS) as [ScenePreset, ...ScenePreset[]])
          .default("studio_gray"),
        customScene: z.string().max(500).default(""),
      })
      .prefault({}),
    shadow: z.enum(["none", "soft", "contact", "reflection"]).default("none"),
    lighting: z
      .object({
        whiteBalance: z.boolean().default(false),
        brighten: z.boolean().default(false),
        recoverShadows: z.boolean().default(false),
        reduceHighlights: z.boolean().default(false),
        trueColors: z.boolean().default(false),
      })
      .prefault({}),
    cleanup: z
      .object({
        dust: z.boolean().default(false),
        scuffs: z.boolean().default(false),
        threads: z.boolean().default(false),
        tags: z.boolean().default(false),
        props: z.boolean().default(false),
        watermarkText: z.boolean().default(false),
      })
      .prefault({}),
    straighten: z.boolean().default(false),
    customInstruction: z.string().max(500).default(""),
  })
  .superRefine((ai, ctx) => {
    if (ai.background.mode === "scene" && ai.background.scenePreset === "custom" && !ai.background.customScene.trim()) {
      ctx.addIssue({
        code: "custom",
        path: ["background", "customScene"],
        message: "Describe the custom scene",
      });
    }
  });

export const StandardSettingsSchema = z
  .object({
    autoTrim: z
      .object({
        enabled: z.boolean().default(false),
        // 0..100 — maps to sharp trim threshold (color distance), see lib/standard-edits.ts
        threshold: z.number().int().min(0).max(100).default(10),
      })
      .prefault({}),
    crop: z
      .object({
        aspect: z.enum(ASPECT_RATIOS).default("original"),
        customWidth: z.number().int().min(1).max(100).default(1),
        customHeight: z.number().int().min(1).max(100).default(1),
        anchor: z.enum(["center", "top", "bottom"]).default("center"),
      })
      .prefault({}),
    fit: z
      .object({
        enabled: z.boolean().default(false),
        width: z.number().int().min(16).max(8000).default(2000),
        height: z.number().int().min(16).max(8000).default(2000),
        paddingPct: z.number().min(0).max(40).default(10),
        fillColor: hexColor.default("#FFFFFF"),
      })
      .prefault({}),
    resize: z
      .object({
        enabled: z.boolean().default(false),
        mode: z.enum(["exact", "longest", "shortest", "percentage"]).default("longest"),
        width: z.number().int().min(16).max(8000).default(2000),
        height: z.number().int().min(16).max(8000).default(2000),
        // longest/shortest side in px, or percentage (1..400)
        value: z.number().int().min(1).max(8000).default(1600),
        lockAspect: z.boolean().default(true),
      })
      .prefault({}),
    adjustments: z
      .object({
        brightness: adjustment,
        contrast: adjustment,
        saturation: adjustment,
        warmth: adjustment,
        sharpness: adjustment,
      })
      .prefault({}),
    watermark: z
      .object({
        enabled: z.boolean().default(false),
        type: z.enum(["logo", "text"]).default("text"),
        logoKey: z.string().nullable().default(null),
        text: z.string().max(100).default(""),
        position: z.enum(WATERMARK_POSITIONS).default("bottom-right"),
        sizePct: z.number().min(1).max(100).default(15),
        opacity: z.number().min(0).max(100).default(60),
        marginPct: z.number().min(0).max(25).default(3),
      })
      .prefault({}),
  })
  .prefault({});

export const OutputSettingsSchema = z
  .object({
    format: z.enum(["jpg", "png", "webp"]).default("jpg"),
    quality: z.number().int().min(50).max(100).default(90),
    maxKb: z.number().int().min(10).max(50000).nullable().default(null),
    stripMetadata: z.boolean().default(true),
    namingPattern: z.string().min(1).max(200).default("{original}"),
    /** Color used to flatten transparency when exporting JPG */
    flattenColor: hexColor.default("#FFFFFF"),
  })
  .prefault({});

export const EditSettingsSchema = z.object({
  ai: AiSettingsSchema.prefault({}),
  standard: StandardSettingsSchema,
  output: OutputSettingsSchema,
});

export type EditSettings = z.infer<typeof EditSettingsSchema>;
export type EditSettingsInput = z.input<typeof EditSettingsSchema>;
export type AiSettings = EditSettings["ai"];
export type StandardSettings = EditSettings["standard"];
export type OutputSettings = EditSettings["output"];

export function defaultEditSettings(): EditSettings {
  return EditSettingsSchema.parse({});
}

/** Parse unknown JSON (e.g. from the DB) into EditSettings, falling back to defaults. */
export function parseEditSettings(value: unknown): EditSettings {
  const result = EditSettingsSchema.safeParse(value ?? {});
  return result.success ? result.data : defaultEditSettings();
}

/** True when any batch-level AI edit is enabled. */
export function hasAiEdits(ai: AiSettings): boolean {
  return (
    ai.background.mode !== "none" ||
    ai.shadow !== "none" ||
    Object.values(ai.lighting).some(Boolean) ||
    Object.values(ai.cleanup).some(Boolean) ||
    ai.straighten ||
    ai.customInstruction.trim().length > 0
  );
}

/** True when an image needs an AI call given batch settings + its own options. */
export function imageNeedsAi(
  ai: AiSettings,
  image: { useOriginal: boolean; perImageInstruction?: string | null },
): boolean {
  if (image.useOriginal) return false;
  return hasAiEdits(ai) || Boolean(image.perImageInstruction?.trim());
}

/**
 * "Background removal → pure white" with no other AI edits: eligible for the
 * cheaper dedicated background-removal provider.
 */
export function isPureWhiteBackgroundOnly(ai: AiSettings, perImageInstruction?: string | null): boolean {
  const bgOnly: AiSettings = {
    ...ai,
    background: { ...ai.background, mode: "none" },
  };
  return (
    ai.background.mode === "solid" &&
    ai.background.color.toUpperCase() === "#FFFFFF" &&
    !hasAiEdits(bgOnly) &&
    !perImageInstruction?.trim()
  );
}

/** Stable stringify (sorted keys) so hashes don't depend on key order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

export function describeOutput(settings: EditSettings): string {
  const fmt = settings.output.format.toUpperCase();
  const { fit, resize } = settings.standard;
  if (fit.enabled) return `${fmt} ${fit.width}×${fit.height}`;
  if (resize.enabled) {
    if (resize.mode === "exact") return `${fmt} ${resize.width}×${resize.height}`;
    if (resize.mode === "percentage") return `${fmt} ${resize.value}%`;
    return `${fmt} ${resize.mode} ${resize.value}px`;
  }
  return `${fmt} original size`;
}
