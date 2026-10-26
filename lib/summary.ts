import { describeOutput, hasAiEdits, SCENE_PRESET_LABELS, type EditSettings } from "./settings";

/** One-line human summary of an EditSettings object (preset cards, confirm modal). */
export function summarizeSettings(s: EditSettings): string {
  const parts: string[] = [];
  const ai = s.ai;
  if (ai.background.mode === "solid")
    parts.push(ai.background.color.toUpperCase() === "#FFFFFF" ? "White bg" : `${ai.background.color} bg`);
  if (ai.background.mode === "scene")
    parts.push(
      ai.background.scenePreset === "custom" ? "Custom scene" : SCENE_PRESET_LABELS[ai.background.scenePreset],
    );
  if (ai.shadow !== "none")
    parts.push({ soft: "soft shadow", contact: "contact shadow", reflection: "reflection" }[ai.shadow]);
  if (Object.values(ai.lighting).some(Boolean)) parts.push("lighting");
  if (Object.values(ai.cleanup).some(Boolean)) parts.push("cleanup");
  if (ai.straighten) parts.push("straighten");
  if (ai.customInstruction.trim()) parts.push("custom AI");
  if (!hasAiEdits(ai)) parts.push("No AI");
  const st = s.standard;
  if (st.autoTrim.enabled) parts.push("trim");
  if (st.crop.aspect !== "original")
    parts.push(
      `crop ${st.crop.aspect === "custom" ? `${st.crop.customWidth}:${st.crop.customHeight}` : st.crop.aspect}`,
    );
  if (st.fit.enabled) parts.push(`pad ${st.fit.paddingPct}%`);
  if (st.watermark.enabled) parts.push("watermark");
  parts.push(describeOutput(s) + ` q${s.output.quality}`);
  if (s.output.maxKb) parts.push(`≤${s.output.maxKb} KB`);
  return parts.join(" · ");
}

/** Bullet list of everything that will be applied (confirm modal / detail panel). */
export function listEdits(s: EditSettings): { ai: string[]; standard: string[] } {
  const ai: string[] = [];
  const a = s.ai;
  if (a.background.mode === "solid") ai.push(`Background → solid ${a.background.color}`);
  if (a.background.mode === "scene")
    ai.push(
      `Background → ${a.background.scenePreset === "custom" ? a.background.customScene : SCENE_PRESET_LABELS[a.background.scenePreset]}`,
    );
  if (a.shadow !== "none") ai.push(`Shadow: ${a.shadow}`);
  const light = Object.entries(a.lighting)
    .filter(([, v]) => v)
    .map(([k]) => k);
  if (light.length) ai.push(`Lighting: ${light.join(", ")}`);
  const clean = Object.entries(a.cleanup)
    .filter(([, v]) => v)
    .map(([k]) => k);
  if (clean.length) ai.push(`Cleanup: ${clean.join(", ")}`);
  if (a.straighten) ai.push("Straighten & center");
  if (a.customInstruction.trim()) ai.push(`Custom: “${a.customInstruction.trim()}”`);

  const standard: string[] = [];
  const st = s.standard;
  if (st.autoTrim.enabled) standard.push(`Auto-trim (threshold ${st.autoTrim.threshold})`);
  if (st.crop.aspect !== "original")
    standard.push(
      `Crop ${st.crop.aspect === "custom" ? `${st.crop.customWidth}:${st.crop.customHeight}` : st.crop.aspect} (${st.crop.anchor})`,
    );
  if (st.fit.enabled)
    standard.push(`Fit ${st.fit.width}×${st.fit.height}, ${st.fit.paddingPct}% padding, ${st.fit.fillColor}`);
  if (st.resize.enabled) {
    const r = st.resize;
    standard.push(
      r.mode === "exact"
        ? `Resize ${r.width}×${r.height}`
        : r.mode === "percentage"
          ? `Resize ${r.value}%`
          : `Resize ${r.mode} side ${r.value}px`,
    );
  }
  const adj = Object.entries(st.adjustments).filter(([, v]) => v !== 0);
  if (adj.length) standard.push(`Adjust: ${adj.map(([k, v]) => `${k} ${v > 0 ? "+" : ""}${v}`).join(", ")}`);
  if (st.watermark.enabled) standard.push(`Watermark (${st.watermark.type}, ${st.watermark.position})`);
  standard.push(
    `Output ${describeOutput(s)}, quality ${s.output.quality}${s.output.maxKb ? `, max ${s.output.maxKb} KB` : ""}${s.output.stripMetadata ? ", metadata stripped" : ""}`,
  );
  return { ai, standard };
}
