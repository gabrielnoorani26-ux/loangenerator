/**
 * Which AI options local mode can perform. Pure; safe to import on the client.
 */
import type { AiSettings } from "../settings";

/** Human-readable list of enabled AI options that local mode will skip. */
export function localUnsupportedEdits(ai: AiSettings, perImageInstruction?: string | null): string[] {
  const out: string[] = [];
  if (Object.values(ai.cleanup).some(Boolean)) out.push("Cleanup");
  if (ai.background.mode === "scene" && ai.background.scenePreset === "custom")
    out.push("Custom scene text (a plain studio backdrop is used)");
  if (ai.customInstruction.trim()) out.push("Custom instruction");
  if (perImageInstruction?.trim()) out.push("Per-image instruction");
  return out;
}
