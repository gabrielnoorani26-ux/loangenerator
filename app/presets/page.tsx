"use client";
import { useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Loader2, MoreHorizontal, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { apiSend, errorMessage } from "@/lib/client/api";
import { qk, useAppSettings, usePresets } from "@/lib/client/hooks";
import { useDebounced } from "@/lib/client/use-debounced";
import type { PresetDTO } from "@/lib/presets";
import { defaultEditSettings, EditSettingsSchema, stableStringify, type EditSettings } from "@/lib/settings";
import { SettingsPanel } from "@/components/settings-panel";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

const CATEGORIES = ["ECOMMERCE", "WHOLESALE", "SOCIAL", "WEB", "CUSTOM"] as const;
const CATEGORY_LABEL: Record<string, string> = {
  ECOMMERCE: "E-commerce",
  WHOLESALE: "Wholesale",
  SOCIAL: "Social",
  WEB: "Web",
  CUSTOM: "Custom",
};

export default function PresetsPage() {
  const { data: presets, isLoading } = usePresets();
  const [editing, setEditing] = useState<PresetDTO | "new" | null>(null);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Presets</h1>
          <p className="text-sm text-muted-foreground">
            Reusable edit settings. The starred preset is used for new batches.
          </p>
        </div>
        <Button onClick={() => setEditing("new")}>
          <Plus /> New preset
        </Button>
      </div>
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-72" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {presets?.map((p) => (
            <PresetCard key={p.id} preset={p} onEdit={() => setEditing(p)} />
          ))}
        </div>
      )}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="h-[92vh] w-[96vw] max-w-6xl grid-rows-[auto_1fr_auto] p-5">
          {editing && (
            <PresetEditor
              key={editing === "new" ? "new" : editing.id}
              preset={editing === "new" ? null : editing}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PresetCard({ preset, onEdit }: { preset: PresetDTO; onEdit: () => void }) {
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast.success(msg);
      qc.invalidateQueries({ queryKey: qk.presets });
      qc.invalidateQueries({ queryKey: qk.appSettings });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Card className="overflow-hidden" data-testid="preset-card">
      <button
        onClick={onEdit}
        className="checkerboard block h-40 w-full cursor-pointer border-b"
        aria-label={`Edit ${preset.name}`}
      >
        {preset.exampleUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preset.exampleUrl} alt="" className="size-full object-contain" loading="lazy" />
        ) : (
          <Skeleton className="size-full rounded-none" />
        )}
      </button>
      <CardContent className="space-y-2 pt-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="flex items-center gap-1.5 truncate font-semibold" data-testid="preset-name">
              {preset.isDefault && (
                <Star className="size-4 shrink-0 fill-amber-400 text-amber-400" aria-label="Default preset" />
              )}
              {preset.name}
            </h3>
            <div className="mt-1 flex gap-1.5">
              <Badge variant="gray">{CATEGORY_LABEL[preset.category]}</Badge>
              <Badge variant="outline">used {preset.usageCount}×</Badge>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label="Preset actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => act(() => apiSend(`/api/presets/${preset.id}/duplicate`, "POST"), "Preset duplicated")}
              >
                <Copy /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={preset.isDefault}
                onSelect={() =>
                  act(() => apiSend(`/api/presets/${preset.id}/default`, "POST"), `“${preset.name}” is now the default`)
                }
              >
                <Star /> Set as default
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                <Trash2 /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <p className="line-clamp-2 text-xs text-muted-foreground" title={preset.summary}>
          {preset.summary}
        </p>
      </CardContent>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete preset “${preset.name}”?`}
        description="Batches that used it keep their own copy of the settings."
        confirmLabel="Delete"
        destructive
        onConfirm={() => act(() => apiSend(`/api/presets/${preset.id}`, "DELETE"), "Preset deleted")}
      />
    </Card>
  );
}

function PresetEditor({ preset, onDone }: { preset: PresetDTO | null; onDone: () => void }) {
  const qc = useQueryClient();
  const { data: app } = useAppSettings();
  const [name, setName] = useState(preset?.name ?? "");
  const [description, setDescription] = useState(preset?.description ?? "");
  const [category, setCategory] = useState<string>(preset?.category ?? "CUSTOM");
  const [settings, setSettings] = useState<EditSettings>(preset?.settings ?? defaultEditSettings());
  const [saving, setSaving] = useState(false);
  const valid = EditSettingsSchema.safeParse(settings).success && name.trim().length > 0;
  const debounced = useDebounced(settings, 300);

  const preview = useQuery({
    queryKey: ["preset-preview", stableStringify(debounced)],
    placeholderData: keepPreviousData,
    enabled: EditSettingsSchema.safeParse(debounced).success,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: debounced }),
        signal,
      });
      if (!res.ok) throw new Error("Preview failed");
      return URL.createObjectURL(await res.blob());
    },
  });

  const save = async () => {
    setSaving(true);
    try {
      const body = { name: name.trim(), description: description || null, category, settings };
      if (preset) await apiSend(`/api/presets/${preset.id}`, "PATCH", body);
      else await apiSend("/api/presets", "POST", body);
      qc.invalidateQueries({ queryKey: qk.presets });
      toast.success(preset ? "Preset saved" : "Preset created");
      onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{preset ? `Edit “${preset.name}”` : "New preset"}</DialogTitle>
      </DialogHeader>
      <div className="grid min-h-0 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="min-h-0 space-y-3 overflow-y-auto pr-1">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <div className="space-y-1">
              <Label htmlFor="p-name">Name</Label>
              <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-36" aria-label="Category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CATEGORY_LABEL[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Textarea
            placeholder="Description (optional)"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <SettingsPanel
            value={settings}
            onChange={setSettings}
            watermarks={app?.watermarkLibrary ?? []}
            defaultOpen={["ai", "standard", "output"]}
          />
        </div>
        <div className="min-h-0">
          <div className="checkerboard relative aspect-square max-h-full overflow-hidden rounded-lg border">
            {preview.data ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.data} alt="Preset preview on sample image" className="size-full object-contain" />
            ) : (
              <Skeleton className="size-full" />
            )}
            {preview.isFetching && (
              <Loader2 className="absolute top-3 right-3 size-5 animate-spin text-muted-foreground" />
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Sample image · standard edits only (AI edits are applied when a batch runs).
          </p>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={save} disabled={!valid || saving}>
          {saving && <Loader2 className="animate-spin" />} {preset ? "Save preset" : "Create preset"}
        </Button>
      </DialogFooter>
    </>
  );
}
