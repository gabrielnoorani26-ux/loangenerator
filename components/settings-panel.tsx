"use client";
/**
 * Editor for EditSettings: AI edits, standard edits and output. Shared by the
 * batch Settings page and the Presets editor.
 */
import { Sparkles } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  ASPECT_RATIOS,
  HEX_COLOR,
  SCENE_PRESET_LABELS,
  WATERMARK_POSITIONS,
  hasAiEdits,
  type EditSettings,
  type ScenePreset,
} from "@/lib/settings";
import { exampleFilename, NAMING_TOKENS } from "@/lib/naming";
import { cn } from "@/lib/utils";

type Updater = (draft: EditSettings) => void;

export interface WatermarkOption {
  id: string;
  name: string;
  key: string;
}

export function SettingsPanel({
  value,
  onChange,
  batchName,
  brand,
  watermarks = [],
  header,
  defaultOpen = ["ai", "standard", "output"],
}: {
  value: EditSettings;
  onChange: (next: EditSettings) => void;
  batchName?: string;
  brand?: string;
  watermarks?: WatermarkOption[];
  header?: React.ReactNode;
  defaultOpen?: string[];
}) {
  const update = (fn: Updater) => {
    const next = structuredClone(value);
    fn(next);
    onChange(next);
  };
  const s = value;
  const aiOn = hasAiEdits(s.ai);

  return (
    <Accordion type="multiple" defaultValue={["preset", ...defaultOpen]} className="rounded-lg border bg-card px-4">
      {header}
      {/* ------------------------------------------------------------- AI */}
      <AccordionItem value="ai">
        <AccordionTrigger>
          <span className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" /> AI Edits
            <Badge variant={aiOn ? "indigo" : "gray"}>{aiOn ? "uses credits" : "off"}</Badge>
          </span>
        </AccordionTrigger>
        <AccordionContent className="space-y-5">
          <Field label="Background">
            <RadioGroup
              value={s.ai.background.mode}
              onValueChange={(v) => update((d) => void (d.ai.background.mode = v as EditSettings["ai"]["background"]["mode"]))}
              className="grid-cols-3"
            >
              {[
                ["none", "Keep"],
                ["solid", "Solid color"],
                ["scene", "Custom scene"],
              ].map(([v, l]) => (
                <label key={v} className="flex cursor-pointer items-center gap-2 text-sm">
                  <RadioGroupItem value={v} aria-label={`Background ${l}`} /> {l}
                </label>
              ))}
            </RadioGroup>
            {s.ai.background.mode === "solid" && (
              <ColorInput value={s.ai.background.color} onChange={(c) => update((d) => void (d.ai.background.color = c))} label="Background color" />
            )}
            {s.ai.background.mode === "scene" && (
              <div className="space-y-2">
                <Select
                  value={s.ai.background.scenePreset}
                  onValueChange={(v) => update((d) => void (d.ai.background.scenePreset = v as ScenePreset))}
                >
                  <SelectTrigger aria-label="Scene preset">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(SCENE_PRESET_LABELS).map(([k, l]) => (
                      <SelectItem key={k} value={k}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {s.ai.background.scenePreset === "custom" && (
                  <Textarea
                    placeholder="Describe the scene, e.g. light oak wood floor with soft window light"
                    maxLength={500}
                    value={s.ai.background.customScene}
                    onChange={(e) => update((d) => void (d.ai.background.customScene = e.target.value))}
                  />
                )}
              </div>
            )}
          </Field>

          <Field label="Shadow">
            <Select value={s.ai.shadow} onValueChange={(v) => update((d) => void (d.ai.shadow = v as EditSettings["ai"]["shadow"]))}>
              <SelectTrigger aria-label="Shadow">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="soft">Soft natural drop shadow</SelectItem>
                <SelectItem value="contact">Contact shadow only</SelectItem>
                <SelectItem value="reflection">Reflection on glossy surface</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="Lighting & color correction">
            <CheckGrid
              items={[
                ["whiteBalance", "Fix white balance"],
                ["brighten", "Brighten evenly"],
                ["recoverShadows", "Recover shadows"],
                ["reduceHighlights", "Reduce harsh highlights"],
                ["trueColors", "True-to-life colors"],
              ]}
              values={s.ai.lighting}
              onToggle={(k, v) => update((d) => void (d.ai.lighting[k as keyof EditSettings["ai"]["lighting"]] = v))}
            />
          </Field>

          <Field label="Cleanup">
            <CheckGrid
              items={[
                ["dust", "Dust / lint"],
                ["scuffs", "Scuffs / creases"],
                ["threads", "Stray threads"],
                ["tags", "Price tags / stickers"],
                ["props", "Props / hands / mannequin"],
                ["watermarkText", "Watermark text"],
              ]}
              values={s.ai.cleanup}
              onToggle={(k, v) => update((d) => void (d.ai.cleanup[k as keyof EditSettings["ai"]["cleanup"]] = v))}
            />
          </Field>

          <ToggleRow
            label="Straighten & center"
            hint="Levels and centers the product without changing its angle"
            checked={s.ai.straighten}
            onChange={(v) => update((d) => void (d.ai.straighten = v))}
          />

          <Field label={`Custom instruction (${s.ai.customInstruction.length}/500)`}>
            <Textarea
              maxLength={500}
              placeholder="Optional extra instruction applied to every image"
              value={s.ai.customInstruction}
              onChange={(e) => update((d) => void (d.ai.customInstruction = e.target.value))}
            />
          </Field>
        </AccordionContent>
      </AccordionItem>

      {/* ------------------------------------------------------- Standard */}
      <AccordionItem value="standard">
        <AccordionTrigger>
          <span className="flex items-center gap-2">
            Standard Edits <Badge variant="green">free</Badge>
          </span>
        </AccordionTrigger>
        <AccordionContent className="space-y-5">
          <ToggleRow
            label="Auto-trim borders"
            hint="Crops near-uniform borders so products are consistently sized"
            checked={s.standard.autoTrim.enabled}
            onChange={(v) => update((d) => void (d.standard.autoTrim.enabled = v))}
          />
          {s.standard.autoTrim.enabled && (
            <SliderRow label="Trim threshold" min={0} max={100} value={s.standard.autoTrim.threshold} onChange={(v) => update((d) => void (d.standard.autoTrim.threshold = v))} />
          )}

          <Field label="Crop to aspect ratio">
            <div className="grid grid-cols-2 gap-2">
              <Select value={s.standard.crop.aspect} onValueChange={(v) => update((d) => void (d.standard.crop.aspect = v as EditSettings["standard"]["crop"]["aspect"]))}>
                <SelectTrigger aria-label="Aspect ratio">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASPECT_RATIOS.map((a) => (
                    <SelectItem key={a} value={a}>
                      {a === "original" ? "Original" : a === "custom" ? "Custom" : a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={s.standard.crop.anchor}
                disabled={s.standard.crop.aspect === "original"}
                onValueChange={(v) => update((d) => void (d.standard.crop.anchor = v as "center" | "top" | "bottom"))}
              >
                <SelectTrigger aria-label="Crop anchor">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="center">Anchor center</SelectItem>
                  <SelectItem value="top">Anchor top</SelectItem>
                  <SelectItem value="bottom">Anchor bottom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {s.standard.crop.aspect === "custom" && (
              <div className="flex items-center gap-2">
                <NumberInput aria-label="Custom ratio width" min={1} max={100} value={s.standard.crop.customWidth} onChange={(v) => update((d) => void (d.standard.crop.customWidth = v))} />
                <span>:</span>
                <NumberInput aria-label="Custom ratio height" min={1} max={100} value={s.standard.crop.customHeight} onChange={(v) => update((d) => void (d.standard.crop.customHeight = v))} />
              </div>
            )}
          </Field>

          <ToggleRow
            label="Fit to canvas"
            hint="Places the full product on a fixed-size canvas with padding"
            checked={s.standard.fit.enabled}
            onChange={(v) => update((d) => void (d.standard.fit.enabled = v))}
          />
          {s.standard.fit.enabled && (
            <div className="space-y-3 rounded-md bg-muted/60 p-3">
              <div className="flex items-center gap-2">
                <NumberInput aria-label="Canvas width" min={16} max={8000} value={s.standard.fit.width} onChange={(v) => update((d) => void (d.standard.fit.width = v))} />
                <span>×</span>
                <NumberInput aria-label="Canvas height" min={16} max={8000} value={s.standard.fit.height} onChange={(v) => update((d) => void (d.standard.fit.height = v))} />
                <span className="text-xs text-muted-foreground">px</span>
              </div>
              <SliderRow label="Padding" suffix="%" min={0} max={40} value={s.standard.fit.paddingPct} onChange={(v) => update((d) => void (d.standard.fit.paddingPct = v))} />
              <ColorInput label="Fill color" value={s.standard.fit.fillColor} onChange={(c) => update((d) => void (d.standard.fit.fillColor = c))} />
            </div>
          )}

          <ToggleRow label="Resize" checked={s.standard.resize.enabled} onChange={(v) => update((d) => void (d.standard.resize.enabled = v))} />
          {s.standard.resize.enabled && (
            <div className="space-y-3 rounded-md bg-muted/60 p-3">
              <Select value={s.standard.resize.mode} onValueChange={(v) => update((d) => void (d.standard.resize.mode = v as EditSettings["standard"]["resize"]["mode"]))}>
                <SelectTrigger aria-label="Resize mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="exact">Exact width × height</SelectItem>
                  <SelectItem value="longest">Longest side</SelectItem>
                  <SelectItem value="shortest">Shortest side</SelectItem>
                  <SelectItem value="percentage">Percentage</SelectItem>
                </SelectContent>
              </Select>
              {s.standard.resize.mode === "exact" ? (
                <>
                  <div className="flex items-center gap-2">
                    <NumberInput aria-label="Resize width" min={16} max={8000} value={s.standard.resize.width} onChange={(v) => update((d) => void (d.standard.resize.width = v))} />
                    <span>×</span>
                    <NumberInput aria-label="Resize height" min={16} max={8000} value={s.standard.resize.height} onChange={(v) => update((d) => void (d.standard.resize.height = v))} />
                  </div>
                  <ToggleRow
                    label="Lock aspect ratio"
                    hint="On: fill the exact size without distortion (edges cropped). Off: stretch."
                    checked={s.standard.resize.lockAspect}
                    onChange={(v) => update((d) => void (d.standard.resize.lockAspect = v))}
                  />
                </>
              ) : (
                <div className="flex items-center gap-2">
                  <NumberInput
                    aria-label="Resize value"
                    min={1}
                    max={s.standard.resize.mode === "percentage" ? 400 : 8000}
                    value={s.standard.resize.value}
                    onChange={(v) => update((d) => void (d.standard.resize.value = v))}
                  />
                  <span className="text-xs text-muted-foreground">{s.standard.resize.mode === "percentage" ? "%" : "px"}</span>
                </div>
              )}
            </div>
          )}

          <Field label="Adjustments">
            {(["brightness", "contrast", "saturation", "warmth", "sharpness"] as const).map((k) => (
              <SliderRow
                key={k}
                label={k.charAt(0).toUpperCase() + k.slice(1)}
                min={-100}
                max={100}
                value={s.standard.adjustments[k]}
                signed
                onChange={(v) => update((d) => void (d.standard.adjustments[k] = v))}
              />
            ))}
          </Field>

          <ToggleRow label="Watermark" checked={s.standard.watermark.enabled} onChange={(v) => update((d) => void (d.standard.watermark.enabled = v))} />
          {s.standard.watermark.enabled && (
            <div className="space-y-3 rounded-md bg-muted/60 p-3">
              <RadioGroup
                value={s.standard.watermark.type}
                onValueChange={(v) => update((d) => void (d.standard.watermark.type = v as "logo" | "text"))}
                className="grid-cols-2"
              >
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <RadioGroupItem value="text" /> Text
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <RadioGroupItem value="logo" /> Logo (PNG)
                </label>
              </RadioGroup>
              {s.standard.watermark.type === "text" ? (
                <Input aria-label="Watermark text" maxLength={100} placeholder="© Chelsea Crew" value={s.standard.watermark.text} onChange={(e) => update((d) => void (d.standard.watermark.text = e.target.value))} />
              ) : watermarks.length ? (
                <Select value={s.standard.watermark.logoKey ?? ""} onValueChange={(v) => update((d) => void (d.standard.watermark.logoKey = v))}>
                  <SelectTrigger aria-label="Watermark logo">
                    <SelectValue placeholder="Choose a logo" />
                  </SelectTrigger>
                  <SelectContent>
                    {watermarks.map((w) => (
                      <SelectItem key={w.id} value={w.key}>
                        {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-xs text-muted-foreground">Upload logos in Settings → Watermark library.</p>
              )}
              <PositionPicker value={s.standard.watermark.position} onChange={(p) => update((d) => void (d.standard.watermark.position = p))} />
              <SliderRow label="Size" suffix="% of width" min={1} max={100} value={s.standard.watermark.sizePct} onChange={(v) => update((d) => void (d.standard.watermark.sizePct = v))} />
              <SliderRow label="Opacity" suffix="%" min={0} max={100} value={s.standard.watermark.opacity} onChange={(v) => update((d) => void (d.standard.watermark.opacity = v))} />
              <SliderRow label="Margin" suffix="%" min={0} max={25} value={s.standard.watermark.marginPct} onChange={(v) => update((d) => void (d.standard.watermark.marginPct = v))} />
            </div>
          )}
        </AccordionContent>
      </AccordionItem>

      {/* --------------------------------------------------------- Output */}
      <AccordionItem value="output">
        <AccordionTrigger>Output</AccordionTrigger>
        <AccordionContent className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Format">
              <Select value={s.output.format} onValueChange={(v) => update((d) => void (d.output.format = v as "jpg" | "png" | "webp"))}>
                <SelectTrigger aria-label="Output format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="jpg">JPG</SelectItem>
                  <SelectItem value="png">PNG</SelectItem>
                  <SelectItem value="webp">WEBP</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Max file size (KB)">
              <Input
                type="number"
                min={10}
                placeholder="No limit"
                aria-label="Max file size KB"
                value={s.output.maxKb ?? ""}
                onChange={(e) => update((d) => void (d.output.maxKb = e.target.value ? Math.max(10, Number(e.target.value)) : null))}
              />
            </Field>
          </div>
          {s.output.format !== "png" && (
            <SliderRow label="Quality" min={50} max={100} value={s.output.quality} onChange={(v) => update((d) => void (d.output.quality = v))} />
          )}
          {s.output.format === "jpg" && (
            <ColorInput label="Transparency fill (JPG)" value={s.output.flattenColor} onChange={(c) => update((d) => void (d.output.flattenColor = c))} />
          )}
          <ToggleRow label="Strip metadata" hint="Removes EXIF/GPS/camera data" checked={s.output.stripMetadata} onChange={(v) => update((d) => void (d.output.stripMetadata = v))} />
          <Field label="Naming pattern">
            <Input aria-label="Naming pattern" value={s.output.namingPattern} onChange={(e) => update((d) => void (d.output.namingPattern = e.target.value || "{original}"))} />
            <div className="flex flex-wrap gap-1">
              {NAMING_TOKENS.map((t) => (
                <button
                  key={t}
                  type="button"
                  className="cursor-pointer rounded border bg-muted px-1.5 py-0.5 font-mono text-xs hover:bg-accent"
                  onClick={() => update((d) => void (d.output.namingPattern = `${d.output.namingPattern}${d.output.namingPattern ? "_" : ""}{${t}}`))}
                >
                  {`{${t}}`}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Example: <span className="font-mono text-foreground" data-testid="example-filename">{exampleFilename(s.output.namingPattern, s.output.format, batchName, brand)}</span>
            </p>
          </Field>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

// ------------------------------------------------------------------ controls

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</p>
      {children}
    </div>
  );
}

function ToggleRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </label>
  );
}

function CheckGrid({
  items,
  values,
  onToggle,
}: {
  items: [string, string][];
  values: Record<string, boolean>;
  onToggle: (key: string, v: boolean) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map(([k, l]) => (
        <Label key={k} className="cursor-pointer font-normal">
          <Checkbox checked={values[k]} onCheckedChange={(v) => onToggle(k, v === true)} aria-label={l} /> {l}
        </Label>
      ))}
    </div>
  );
}

export function SliderRow({
  label,
  value,
  min,
  max,
  onChange,
  suffix,
  signed,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  suffix?: string;
  signed?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {signed && value > 0 ? "+" : ""}
          {value}
          {suffix ? ` ${suffix}` : ""}
        </span>
      </div>
      <Slider min={min} max={max} step={1} value={[value]} onValueChange={([v]) => onChange(v)} aria-label={label} />
    </div>
  );
}

function NumberInput({ value, onChange, min, max, ...rest }: { value: number; onChange: (v: number) => void; min: number; max: number } & Omit<React.ComponentProps<"input">, "onChange" | "value">) {
  return (
    <Input
      type="number"
      className="w-24"
      min={min}
      max={max}
      value={value}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, Math.round(n))));
      }}
      {...rest}
    />
  );
}

export function ColorInput({ value, onChange, label }: { value: string; onChange: (c: string) => void; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        className="h-8 w-10 cursor-pointer rounded border bg-card p-0.5"
        aria-label={label}
      />
      <Input
        className={cn("w-28 font-mono uppercase", !HEX_COLOR.test(value) && "border-destructive")}
        defaultValue={value}
        key={value}
        onBlur={(e) => {
          const v = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
          if (HEX_COLOR.test(v)) onChange(v.toUpperCase());
        }}
        aria-label={`${label} hex`}
      />
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function PositionPicker({ value, onChange }: { value: string; onChange: (p: (typeof WATERMARK_POSITIONS)[number]) => void }) {
  return (
    <div className="flex items-center gap-3">
      <div className="grid w-20 grid-cols-3 gap-1">
        {WATERMARK_POSITIONS.map((p) => (
          <button
            key={p}
            type="button"
            title={p}
            aria-label={`Position ${p}`}
            onClick={() => onChange(p)}
            className={cn("aspect-square cursor-pointer rounded-sm border", value === p ? "border-primary bg-primary" : "bg-card hover:bg-accent")}
          />
        ))}
      </div>
      <span className="text-xs text-muted-foreground">{value}</span>
    </div>
  );
}
