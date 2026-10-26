"use client";
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CheckCircle2, Loader2, Plug, Plus, Trash2, Upload, X, XCircle } from "lucide-react";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";
import { qk, useAppSettings, useConfig, usePresets } from "@/lib/client/hooks";
import type { AppSettingsDTO } from "@/lib/app-settings";
import type { Stats } from "@/lib/stats";
import { exampleFilename, NAMING_TOKENS } from "@/lib/naming";
import { SliderRow } from "@/components/settings-panel";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

export default function SettingsPage() {
  const { data: settings } = useAppSettings();
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Applies to all batches. API keys are configured in the server’s .env file.</p>
      </div>
      {settings ? <SettingsForm key={settings.id} initial={settings} /> : <Skeleton className="h-96" />}
      <WatermarkLibrary />
      <Usage />
      <ConnectionTests />
    </div>
  );
}

function SettingsForm({ initial }: { initial: AppSettingsDTO }) {
  const qc = useQueryClient();
  const { data: presets } = usePresets();
  const [s, setS] = useState(initial);
  const [newBrand, setNewBrand] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async (patch: Partial<AppSettingsDTO>) => {
    const next = { ...s, ...patch };
    setS(next);
    setSaving(true);
    try {
      await apiSend("/api/settings", "PATCH", patch);
      qc.invalidateQueries({ queryKey: qk.appSettings });
      if (patch.defaultPresetId !== undefined) qc.invalidateQueries({ queryKey: qk.presets });
    } catch (e) {
      toast.error(errorMessage(e));
      setS(s);
    } finally {
      setSaving(false);
    }
  };
  const addBrand = () => {
    const b = newBrand.trim();
    if (!b || s.brandList.includes(b)) return;
    save({ brandList: [...s.brandList, b] });
    setNewBrand("");
  };

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Processing {saving && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          </CardTitle>
          <CardDescription>Queue and quality-control behaviour.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label>Default preset</Label>
            <Select value={s.defaultPresetId ?? ""} onValueChange={(v) => save({ defaultPresetId: v })}>
              <SelectTrigger aria-label="Default preset">
                <SelectValue placeholder="Choose…" />
              </SelectTrigger>
              <SelectContent>
                {presets?.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <SliderRow label="Concurrent AI calls" min={1} max={5} value={s.maxConcurrentAiCalls} onChange={(v) => setS({ ...s, maxConcurrentAiCalls: v })} />
          <SliderRow label="Retries per image" min={0} max={5} value={s.maxRetries} onChange={(v) => setS({ ...s, maxRetries: v })} />
          <label className="flex items-center justify-between gap-3">
            <span>
              <span className="block text-sm font-medium">Automatic QC</span>
              <span className="block text-xs text-muted-foreground">Vision check flags images where the product may have been altered</span>
            </span>
            <Switch checked={s.autoQcEnabled} onCheckedChange={(v) => save({ autoQcEnabled: v })} aria-label="Automatic QC" />
          </label>
          <SliderRow label="QC threshold (below = Needs review)" min={0} max={100} value={s.qcThreshold} onChange={(v) => setS({ ...s, qcThreshold: v })} />
          <Button
            size="sm"
            variant="outline"
            onClick={() => save({ maxConcurrentAiCalls: s.maxConcurrentAiCalls, maxRetries: s.maxRetries, qcThreshold: s.qcThreshold }).then(() => toast.success("Saved"))}
            disabled={saving}
          >
            Save processing settings
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Brands & naming</CardTitle>
          <CardDescription>Brand list for batches and the default output filename pattern.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label>Brands</Label>
            <div className="flex flex-wrap gap-1.5">
              {s.brandList.map((b) => (
                <Badge key={b} variant="outline" className="gap-1 py-1">
                  {b}
                  <button
                    onClick={() => s.brandList.length > 1 && save({ brandList: s.brandList.filter((x) => x !== b) })}
                    aria-label={`Remove ${b}`}
                    className="cursor-pointer text-muted-foreground hover:text-destructive"
                    disabled={s.brandList.length <= 1}
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Input placeholder="Add brand" value={newBrand} onChange={(e) => setNewBrand(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addBrand()} />
              <Button variant="outline" onClick={addBrand} disabled={!newBrand.trim()}>
                <Plus /> Add
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="naming">Default naming pattern</Label>
            <Input
              id="naming"
              value={s.defaultNamingPattern}
              onChange={(e) => setS({ ...s, defaultNamingPattern: e.target.value })}
              onBlur={() => s.defaultNamingPattern.trim() && save({ defaultNamingPattern: s.defaultNamingPattern.trim() })}
            />
            <p className="text-xs text-muted-foreground">
              Tokens: {NAMING_TOKENS.map((t) => `{${t}}`).join(" ")} · Example: <span className="font-mono">{exampleFilename(s.defaultNamingPattern || "{original}", "jpg")}</span>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function WatermarkLibrary() {
  const qc = useQueryClient();
  const { data: settings } = useAppSettings();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/watermarks", { method: "POST", body: form });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message ?? "Upload failed");
      toast.success("Logo added");
      qc.invalidateQueries({ queryKey: qk.appSettings });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setUploading(false);
    }
  };
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>Watermark library</CardTitle>
          <CardDescription>PNG logos (transparent background recommended).</CardDescription>
        </div>
        <Button variant="outline" onClick={() => input.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="animate-spin" /> : <Upload />} Upload PNG
        </Button>
        <input ref={input} type="file" accept="image/png" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </CardHeader>
      <CardContent>
        {!settings?.watermarkLibrary.length ? (
          <p className="text-sm text-muted-foreground">No logos yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
            {settings.watermarkLibrary.map((w) => (
              <div key={w.id} className="group relative rounded-md border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/files/${w.key}`} alt={w.name} className="checkerboard aspect-square w-full rounded-t-md object-contain p-2" />
                <p className="truncate px-2 py-1 text-xs">{w.name}</p>
                <button
                  className="absolute top-1 right-1 cursor-pointer rounded bg-white/90 p-1 opacity-0 shadow group-hover:opacity-100 hover:text-destructive"
                  onClick={() => setRemoving(w.id)}
                  aria-label={`Delete ${w.name}`}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Delete this logo?"
        description="Presets or batches that use it will skip the watermark."
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          try {
            await apiSend(`/api/watermarks/${removing}`, "DELETE");
            qc.invalidateQueries({ queryKey: qk.appSettings });
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </Card>
  );
}

function Usage() {
  const { data: stats } = useQuery({ queryKey: ["stats"], queryFn: () => apiGet<Stats>("/api/stats") });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Usage</CardTitle>
        <CardDescription>AI calls by month (image edits + background removals).</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-[2fr_1fr]">
        <div className="h-56" data-testid="usage-chart">
          {stats ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.aiCallsByMonth} margin={{ left: -20, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
                <Tooltip cursor={{ fill: "#EEF2FF" }} formatter={(v) => [v, "AI calls"]} />
                <Bar dataKey="aiCalls" fill="#4338CA" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Skeleton className="size-full" />
          )}
        </div>
        <div className="space-y-4 text-sm">
          <div>
            <p className="text-muted-foreground">Total images</p>
            <p className="text-2xl font-semibold tabular-nums">{stats?.totalImages ?? "—"}</p>
            <p className="text-xs text-muted-foreground">across {stats?.totalBatches ?? "—"} batches</p>
          </div>
          <div>
            <p className="mb-1 text-muted-foreground">Top presets</p>
            {stats?.topPresets.length ? (
              <ol className="space-y-0.5">
                {stats.topPresets.map((p) => (
                  <li key={p.id} className="flex justify-between gap-2">
                    <span className="truncate">{p.name}</span>
                    <span className="text-muted-foreground tabular-nums">{p.usageCount}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-xs text-muted-foreground">No presets used yet.</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface Check {
  name: string;
  configured: boolean;
  ok: boolean;
  message: string;
}

function ConnectionTests() {
  const { data: config } = useConfig();
  const [results, setResults] = useState<Check[] | null>(null);
  const [running, setRunning] = useState(false);
  const run = async () => {
    setRunning(true);
    try {
      setResults((await apiSend<{ results: Check[] }>("/api/settings/test-connections", "POST")).results);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRunning(false);
    }
  };
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>API connections</CardTitle>
          <CardDescription>
            Image provider: <span className="font-medium">{config?.imageProvider ?? "…"}</span>. Each configured key is verified with a minimal request.
          </CardDescription>
        </div>
        <Button variant="outline" onClick={run} disabled={running}>
          {running ? <Loader2 className="animate-spin" /> : <Plug />} Test API connections
        </Button>
      </CardHeader>
      {results && (
        <CardContent className="space-y-2">
          {results.map((r) => (
            <div key={r.name} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
              <span className="flex items-center gap-2">
                {r.ok ? <CheckCircle2 className="size-4 text-emerald-600" /> : <XCircle className={r.configured ? "size-4 text-destructive" : "size-4 text-muted-foreground"} />}
                {r.name}
              </span>
              <span className={r.ok ? "text-emerald-700" : r.configured ? "text-destructive" : "text-muted-foreground"}>{r.message}</span>
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );
}
