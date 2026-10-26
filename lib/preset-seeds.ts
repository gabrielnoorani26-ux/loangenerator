/** The six built-in presets from the spec, expressed as EditSettings inputs. */
import type { EditSettingsInput } from "./settings";

export interface PresetSeed {
  name: string;
  description: string;
  category: "ECOMMERCE" | "WHOLESALE" | "SOCIAL" | "WEB" | "CUSTOM";
  isDefault?: boolean;
  settings: EditSettingsInput;
}

export const PRESET_SEEDS: PresetSeed[] = [
  {
    name: "E-commerce White Background",
    description: "White background, soft shadow, cleaned and centered. 2000×2000 JPG.",
    category: "ECOMMERCE",
    isDefault: true,
    settings: {
      ai: {
        background: { mode: "solid", color: "#FFFFFF" },
        shadow: "soft",
        lighting: { whiteBalance: true },
        cleanup: { dust: true },
        straighten: true,
      },
      standard: {
        autoTrim: { enabled: true, threshold: 10 },
        fit: { enabled: true, width: 2000, height: 2000, paddingPct: 10, fillColor: "#FFFFFF" },
        adjustments: { sharpness: 10 },
      },
      output: { format: "jpg", quality: 90, namingPattern: "{style}_{color}_{view}" },
    },
  },
  {
    name: "Shopify Product",
    description: "White background with contact shadow. 2048×2048 WEBP under 500 KB.",
    category: "ECOMMERCE",
    settings: {
      ai: {
        background: { mode: "solid", color: "#FFFFFF" },
        shadow: "contact",
        cleanup: { dust: true },
      },
      standard: {
        autoTrim: { enabled: true, threshold: 10 },
        fit: { enabled: true, width: 2048, height: 2048, paddingPct: 8, fillColor: "#FFFFFF" },
      },
      output: { format: "webp", quality: 85, maxKb: 500, namingPattern: "{style}_{color}_{view}" },
    },
  },
  {
    name: "Amazon Main Image",
    description: "Pure white background, no shadow, props and tags removed. 2000×2000 JPG.",
    category: "ECOMMERCE",
    settings: {
      ai: {
        background: { mode: "solid", color: "#FFFFFF" },
        shadow: "none",
        cleanup: { props: true, tags: true },
      },
      standard: {
        autoTrim: { enabled: true, threshold: 10 },
        fit: { enabled: true, width: 2000, height: 2000, paddingPct: 7, fillColor: "#FFFFFF" },
      },
      output: { format: "jpg", quality: 95, namingPattern: "{style}_{color}_{view}" },
    },
  },
  {
    name: "Wholesale Line Sheet",
    description: "White background, soft shadow, lighting and scuff fixes. 1200×1200 JPG.",
    category: "WHOLESALE",
    settings: {
      ai: {
        background: { mode: "solid", color: "#FFFFFF" },
        shadow: "soft",
        lighting: { whiteBalance: true, brighten: true, recoverShadows: true, reduceHighlights: true },
        cleanup: { scuffs: true },
      },
      standard: {
        autoTrim: { enabled: true, threshold: 10 },
        fit: { enabled: true, width: 1200, height: 1200, paddingPct: 12, fillColor: "#FFFFFF" },
      },
      output: { format: "jpg", quality: 85, namingPattern: "{brand}_{style}_{color}" },
    },
  },
  {
    name: "Instagram Lifestyle",
    description: "Light oak floor scene with matched lighting. 4:5, 1080×1350 JPG.",
    category: "SOCIAL",
    settings: {
      ai: {
        background: {
          mode: "scene",
          scenePreset: "custom",
          customScene: "light oak wood floor with soft natural window light, minimal and clean",
        },
        lighting: { trueColors: true },
      },
      standard: {
        crop: { aspect: "4:5", anchor: "center" },
        resize: { enabled: true, mode: "exact", width: 1080, height: 1350, lockAspect: false },
      },
      output: { format: "jpg", quality: 90, namingPattern: "{style}_{color}_{view}" },
    },
  },
  {
    name: "Web Optimize Only (No AI)",
    description: "No AI. Longest side 1600 px, metadata stripped, WEBP 80.",
    category: "WEB",
    settings: {
      standard: {
        resize: { enabled: true, mode: "longest", value: 1600, lockAspect: true },
      },
      output: { format: "webp", quality: 80, stripMetadata: true, namingPattern: "{original}" },
    },
  },
];
