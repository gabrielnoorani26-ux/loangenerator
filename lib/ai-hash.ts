import { createHash } from "node:crypto";
import { buildPrompt } from "./prompt-builder";
import { isPureWhiteBackgroundOnly, type AiSettings } from "./settings";

/**
 * Cache key for an AI result. The prompt fully determines the AI request, so
 * hashing it (plus the route) means irrelevant setting changes — or standard
 * edit changes — never invalidate a cached result.
 */
export function aiSettingsHash(ai: AiSettings, perImageInstruction?: string | null): string | null {
  const prompt = buildPrompt(ai, perImageInstruction);
  if (!prompt) return null;
  const route = isPureWhiteBackgroundOnly(ai, perImageInstruction) ? "white-bg" : "edit";
  return createHash("sha256").update(`${route}\n${prompt}`).digest("hex");
}
