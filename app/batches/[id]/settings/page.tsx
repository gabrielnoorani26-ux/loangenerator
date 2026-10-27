"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, Eye, FlaskConical, Loader2, Play, Save } from "lucide-react";
import { apiSend, errorMessage } from "@/lib/client/api";
import { localUnsupportedEdits } from "@/lib/local/support";
import { qk, useAppSettings, useBatch, useConfig, useImages, usePresets } from "@/lib/client/hooks";
import {
  EditSettingsSchema,
  describeOutput,
  hasAiEdits,
  imageNeedsAi,
  stableStringify,
  type EditSettings,
} from "@/lib/settings";
import { buildPrompt } from "@/lib/prompt-builder";
import { listEdits } from "@/lib/summary";
import type { Estimate } from "@/lib/estimate";
import type { BatchDTO } from "@/lib/batches";
import { useDebounced } from "@/lib/client/use-debounced";
import { SettingsPanel } from "@/components/settings-panel";
import { BeforeAfter } from "@/components/before-after";
import { StickyBar } from "@/components/sticky-bar";
import { AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn, formatCents } from "@/lib/utils";

export default function SettingsPage() {
  const { id } = useParams<{ id: string }>();
  const { data: batch } = useBatch(id);
  if (!batch) {
    return (
      <div className="grid gap-6 p-6 lg:grid-cols-[2fr_3fr]">
        <Skeleton className="h-[70vh]" />
        <Skeleton className="h-[70vh]" />
      </div>
    );
  }
  // Keyed so local draft state initializes once per batch.
  return <SettingsEditor key={batch.id} batch={batch} />;
}

function SettingsEditor({ batch }: { batch: BatchDTO }) {
  const id = batch.id;
  const router = useRouter();
  const qc = useQueryClient();
  const { data: images } = useImages(id);
  const { data: presets } = usePresets();
  const { data: app } = useAppSettings();
  const { data: config } = useConfig();

  const [settings, setSettings] = useState<EditSettings>(batch.settings);
  const [presetId, setPresetId] = useState<string | null>(batch.presetId);
  const [chosenImage, setSelectedImage] = useState<string | null>(null);
  const selectedImage = chosenImage ?? images?.[0]?.id ?? null;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [saveAsOpen, setSaveAsOpen] = useState(false);

  const validation = useMemo(() => EditSettingsSchema.safeParse(settings), [settings]);
  const valid = validation?.success ?? false;

  // Persist settings (debounced) so a refresh never loses work.
  const debouncedSettings = useDebounced(settings, 600);
  useEffect(() => {
    if (!EditSettingsSchema.safeParse(debouncedSettings).success) return;
    if (stableStringify(debouncedSettings) === stableStringify(batch.settings) && presetId === batch.presetId) return;
    if (batch.status === "PROCESSING" || batch.status === "PAUSED") return;
    apiSend(`/api/batches/${id}`, "PATCH", { settings: debouncedSettings, presetId })
      .then(() => qc.invalidateQueries({ queryKey: qk.batch(id) }))
      .catch((e) => toast.error(errorMessage(e)));
  }, [debouncedSettings, presetId, batch.settings, batch.presetId, batch.status, id, qc]);

  const preset = presets?.find((p) => p.id === presetId) ?? null;
  const modified = !!(preset && stableStringify(preset.settings) !== stableStringify(settings));

  // Estimate for the draft settings.
  const estimateSettings = useDebounced(valid ? settings : null, 400);
  const imagesKey = images
    ?.map((i) => `${i.id}:${i.useOriginal}:${i.perImageInstruction ?? ""}:${i.hasAiResult}`)
    .join("|");
  const { data: estimate } = useQuery({
    queryKey: ["estimate-draft", id, stableStringify(estimateSettings), imagesKey],
    enabled: !!estimateSettings,
    queryFn: async () =>
      (await apiSend<{ estimate: Estimate }>(`/api/batches/${id}/estimate`, "POST", { settings: estimateSettings }))
        .estimate,
  });

  const loadPreset = (pid: string) => {
    const p = presets?.find((x) => x.id === pid);
    if (!p) return;
    setPresetId(pid);
    setSettings(structuredClone(p.settings));
    toast.success(`Loaded preset “${p.name}”`);
  };

  const updatePreset = async () => {
    if (!preset) return;
    try {
      await apiSend(`/api/presets/${preset.id}`, "PATCH", { settings });
      qc.invalidateQueries({ queryKey: qk.presets });
      toast.success(`Updated preset “${preset.name}”`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const start = async () => {
    setStarting(true);
    try {
      await apiSend(`/api/batches/${id}`, "PATCH", { settings, presetId });
      await apiSend(`/api/batches/${id}/start`, "POST", {});
      qc.invalidateQueries({ queryKey: qk.batch(id) });
      router.push(`/batches/${id}/processing`);
    } catch (e) {
      toast.error(errorMessage(e));
      setStarting(false);
    }
  };

  const locked = batch.status === "PROCESSING" || batch.status === "PAUSED";
  const aiOn = hasAiEdits(settings.ai);
  const edits = listEdits(settings);
  const unsupported = localUnsupportedEdits(settings.ai);
  const imageCount = images?.length ?? 0;

  return (
    <>
      <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="min-w-0 space-y-4">
          {locked && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              This batch is processing — settings are locked.
            </div>
          )}
          <fieldset disabled={locked} className="min-w-0">
            <SettingsPanel
              value={settings}
              onChange={setSettings}
              batchName={batch.name}
              brand={batch.brand}
              watermarks={app?.watermarkLibrary ?? []}
              header={
                <AccordionItem value="preset">
                  <AccordionTrigger>
                    <span className="flex items-center gap-2">
                      Preset
                      {preset && <Badge variant="outline">{preset.name}</Badge>}
                      {modified && <Badge variant="amber">modified</Badge>}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-3">
                    <Select value={presetId ?? ""} onValueChange={loadPreset}>
                      <SelectTrigger aria-label="Load preset">
                        <SelectValue placeholder="Load a preset…" />
                      </SelectTrigger>
                      <SelectContent>
                        {presets?.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                            {p.isDefault ? " ★" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => setSaveAsOpen(true)} disabled={!valid}>
                        <Save /> Save as new preset
                      </Button>
                      {preset && (
                        <Button size="sm" variant="outline" onClick={updatePreset} disabled={!modified || !valid}>
                          Update “{preset.name}”
                        </Button>
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              }
            />
          </fieldset>
          {!validation.success && <p className="text-sm text-destructive">{validation.error.issues[0]?.message}</p>}
        </div>

        <div className="min-w-0">
          <div className="sticky top-4">
            <PreviewPanel
              batchId={id}
              settings={valid ? settings : null}
              selectedImage={selectedImage}
              onSelect={setSelectedImage}
            />
          </div>
        </div>
      </div>

      <StickyBar>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm" data-testid="cost-bar">
            <span className="font-medium">{imageCount} images</span>
            {" • "}
            {config?.localMode && aiOn ? (
              <span>
                {estimate ? estimate.aiCalls + estimate.bgRemovalCalls : "…"} local edits ·{" "}
                <span className="text-emerald-700">free, runs on this computer</span>
                {estimate && estimate.cacheHits > 0 && (
                  <span className="text-muted-foreground"> · {estimate.cacheHits} cached</span>
                )}
              </span>
            ) : aiOn || (estimate?.aiCalls ?? 0) > 0 ? (
              <span>
                {estimate ? estimate.aiCalls + estimate.bgRemovalCalls : "…"} AI calls (est.{" "}
                {estimate ? formatCents(estimate.estimatedCostCents) : "…"})
                {estimate && estimate.cacheHits > 0 && (
                  <span className="text-muted-foreground"> · {estimate.cacheHits} cached</span>
                )}
              </span>
            ) : (
              <span className="text-emerald-700">No AI credits will be used</span>
            )}
            {" • "}Output: {describeOutput(settings)}
          </p>
          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={!valid || imageCount === 0 || locked || starting}
            data-testid="start-processing"
          >
            <Play /> Start Processing
          </Button>
        </div>
      </StickyBar>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Start processing {imageCount} images?</DialogTitle>
            <DialogDescription>Processing runs on the server — you can close this tab and come back.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div>
              <p className="mb-1 font-medium">
                AI edits{" "}
                {aiOn && (
                  <Badge variant={config?.localMode ? "green" : "indigo"}>
                    {config?.localMode ? "local · free" : "uses credits"}
                  </Badge>
                )}
              </p>
              {edits.ai.length ? (
                <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                  {edits.ai.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">None</p>
              )}
            </div>
            <div>
              <p className="mb-1 font-medium">Standard edits</p>
              <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                {edits.standard.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
            {config?.localMode && unsupported.length > 0 && (
              <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
                Skipped in local mode: {unsupported.join(", ")}.
              </p>
            )}
            <div className="rounded-md bg-muted p-3">
              {config?.localMode ? (
                <p className="text-emerald-700">
                  Runs on this computer — no API calls, no credits.
                  {estimate && estimate.cacheHits > 0 && ` ${estimate.cacheHits} reuse cached results.`}
                </p>
              ) : estimate && estimate.aiCalls + estimate.bgRemovalCalls > 0 ? (
                <p>
                  <span className="font-semibold">{estimate.aiCalls + estimate.bgRemovalCalls} AI calls</span> ·
                  estimated <span className="font-semibold">{formatCents(estimate.estimatedCostCents)}</span>
                  {estimate.cacheHits > 0 && ` · ${estimate.cacheHits} reuse cached AI results`}
                  {estimate.skippedOriginal > 0 && ` · ${estimate.skippedOriginal} use the original`}
                  {config && !config.imageProviderConfigured && (
                    <span className="mt-1 block text-destructive">
                      No AI provider API key is configured — AI steps will fail.
                    </span>
                  )}
                </p>
              ) : (
                <p className="text-emerald-700">No AI credits will be used.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={start} disabled={starting} data-testid="confirm-start">
              {starting ? <Loader2 className="animate-spin" /> : <Play />} Start processing
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SavePresetDialog
        open={saveAsOpen}
        onOpenChange={setSaveAsOpen}
        settings={settings}
        onSaved={(pid) => setPresetId(pid)}
      />
    </>
  );
}

function SavePresetDialog({
  open,
  onOpenChange,
  settings,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  settings: EditSettings;
  onSaved: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const r = await apiSend<{ preset: { id: string } }>("/api/presets", "POST", {
        name,
        settings,
        category: "CUSTOM",
      });
      qc.invalidateQueries({ queryKey: qk.presets });
      onSaved(r.preset.id);
      toast.success(`Saved preset “${name}”`);
      onOpenChange(false);
      setName("");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save as new preset</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          placeholder="Preset name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && name.trim() && save()}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!name.trim() || saving}>
            {saving && <Loader2 className="animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PreviewPanel({
  batchId,
  settings,
  selectedImage,
  onSelect,
}: {
  batchId: string;
  settings: EditSettings | null;
  selectedImage: string | null;
  onSelect: (id: string) => void;
}) {
  const qc = useQueryClient();
  const local = useConfig().data?.localMode ?? false;
  const { data: images } = useImages(batchId);
  const image = images?.find((i) => i.id === selectedImage) ?? null;
  const [mode, setMode] = useState<"slider" | "edited" | "original">("slider");
  const [testing, setTesting] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const debounced = useDebounced(settings, 300);

  const preview = useQuery({
    queryKey: ["preview", image?.id, image?.aiUrl, stableStringify(debounced)],
    enabled: !!debounced && !!image,
    placeholderData: keepPreviousData,
    gcTime: 30_000,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageId: image!.id, settings: debounced }),
        signal,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "Preview failed");
      }
      const url = URL.createObjectURL(await res.blob());
      const info = `${res.headers.get("X-Output-Width")}×${res.headers.get("X-Output-Height")}${res.headers.get("X-Used-Ai") === "1" ? " · includes cached AI result" : ""}`;
      return { url, info };
    },
  });
  const previewUrl = preview.data?.url ?? null;
  const previewInfo = preview.data?.info ?? "";
  const loading = preview.isFetching;
  const error = preview.error ? (preview.error as Error).message : null;

  const needsAi = !!(settings && image && imageNeedsAi(settings.ai, image));
  const prompt = settings ? buildPrompt(settings.ai, image?.perImageInstruction) : null;

  const testAi = async () => {
    if (!image || !settings) return;
    setTesting(true);
    try {
      const r = await apiSend<{ cached: boolean }>("/api/preview/ai-test", "POST", { imageId: image.id, settings });
      toast.success(
        r.cached
          ? "AI result already cached for these settings"
          : "AI test complete — the batch run will reuse this result",
      );
      await qc.invalidateQueries({ queryKey: qk.images(batchId) });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup type="single" value={mode} onValueChange={(v) => v && setMode(v as typeof mode)}>
          <ToggleGroupItem value="slider">Before / after</ToggleGroupItem>
          <ToggleGroupItem value="edited">Edited</ToggleGroupItem>
          <ToggleGroupItem value="original">Original</ToggleGroupItem>
        </ToggleGroup>
        <div className="flex items-center gap-2">
          {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          <span className="text-xs text-muted-foreground">{previewInfo}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={testAi}
            disabled={!needsAi || testing}
            title={
              needsAi
                ? `Runs the AI step on this one image (${local ? "free, local" : "uses 1 credit"})`
                : "No AI edits enabled"
            }
          >
            {testing ? <Loader2 className="animate-spin" /> : <FlaskConical />} Test AI on this image
          </Button>
        </div>
      </div>

      <div className="relative aspect-[4/3] overflow-hidden rounded-lg border bg-card" data-testid="preview">
        {!image ? (
          <Skeleton className="size-full" />
        ) : error ? (
          <div className="flex size-full items-center justify-center p-6 text-sm text-destructive">{error}</div>
        ) : !previewUrl ? (
          <Skeleton className="size-full" />
        ) : mode === "slider" ? (
          <BeforeAfter before={image.originalUrl!} after={previewUrl} afterLabel="Preview" beforeLabel="Original" />
        ) : (
          <div className="checkerboard size-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={mode === "edited" ? previewUrl : image.originalUrl!}
              alt=""
              className="size-full object-contain"
            />
          </div>
        )}
      </div>
      {needsAi && !image?.hasAiResult && (
        <p className="text-xs text-muted-foreground">
          Preview shows standard edits only. Use “Test AI on this image” to see the AI result (
          {local ? "free" : "1 credit"}).
        </p>
      )}

      <div className="flex gap-2 overflow-x-auto pb-1" data-testid="thumb-strip">
        {images?.map((img) => (
          <button
            key={img.id}
            onClick={() => onSelect(img.id)}
            className={cn(
              "checkerboard relative size-16 shrink-0 cursor-pointer overflow-hidden rounded-md border-2",
              img.id === selectedImage ? "border-primary" : "border-transparent",
            )}
            title={img.originalFilename}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.originalThumbUrl ?? ""} alt="" className="size-full object-contain" loading="lazy" />
            {img.hasAiResult && (
              <span className="absolute right-0.5 bottom-0.5 size-2 rounded-full bg-primary" title="AI result cached" />
            )}
          </button>
        ))}
      </div>

      <div className="rounded-lg border bg-card">
        <button
          className="flex w-full cursor-pointer items-center justify-between px-4 py-2.5 text-sm font-medium"
          onClick={() => setPromptOpen((o) => !o)}
        >
          <span className="flex items-center gap-2">
            <Eye className="size-4" /> View AI prompt
          </span>
          <ChevronDown className={cn("size-4 transition-transform", promptOpen && "rotate-180")} />
        </button>
        {promptOpen && (
          <pre
            className="max-h-72 overflow-auto border-t bg-muted/50 p-4 text-xs whitespace-pre-wrap"
            data-testid="ai-prompt"
          >
            {prompt ?? "No AI edits enabled — no AI call will be made."}
          </pre>
        )}
      </div>
    </div>
  );
}
