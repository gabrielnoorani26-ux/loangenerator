"use client";
import { useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, GripVertical, ImagePlus, Loader2, Trash2, Upload, Wand2, X } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { apiSend, errorMessage } from "@/lib/client/api";
import { qk, useAppSettings, useBatch, useConfig, useImages } from "@/lib/client/hooks";
import type { ImageDTO } from "@/lib/batches";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { StickyBar } from "@/components/sticky-bar";
import { cn, formatBytesKb } from "@/lib/utils";

const VIEWS = ["SIDE", "FRONT", "BACK", "TOP", "SOLE", "PAIR", "DETAIL", "LIFESTYLE", "OTHER"] as const;
const ACCEPT_EXT = /\.(jpe?g|png|webp|heic|heif)$/i;
const PARALLEL = 5;

interface UploadItem {
  key: string;
  file: File;
  progress: number;
  state: "pending" | "uploading" | "done" | "error";
  error?: string;
  duplicate?: boolean;
}

function uploadOne(
  batchId: string,
  item: UploadItem,
  onProgress: (p: number) => void,
): Promise<{ duplicate?: boolean; error?: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("files", item.file, item.file.name);
    xhr.open("POST", `/api/batches/${batchId}/images`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 95));
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText) as {
          results?: { error?: string; duplicate?: boolean }[];
          error?: { message: string };
        };
        const r = body.results?.[0];
        if (xhr.status >= 400) resolve({ error: r?.error ?? body.error?.message ?? "Upload failed" });
        else resolve({ duplicate: r?.duplicate, error: r?.error });
      } catch {
        resolve({ error: "Upload failed — unexpected server response" });
      }
    };
    xhr.onerror = () => resolve({ error: "Network error — check the server is running" });
    xhr.send(form);
  });
}

export default function UploadPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: batch } = useBatch(id);
  const { data: images, isLoading } = useImages(id);
  const { data: app } = useAppSettings();
  const { data: config } = useConfig();
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [editing, setEditing] = useState<ImageDTO | null>(null);
  const [pendingOrder, setPendingOrder] = useState<string[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const queueRef = useRef<UploadItem[]>([]);
  const activeRef = useRef(0);

  const order = useMemo(() => pendingOrder ?? (images ?? []).map((i) => i.id), [pendingOrder, images]);
  const byId = useMemo(() => new Map((images ?? []).map((i) => [i.id, i])), [images]);
  const maxMb = config?.maxUploadMb ?? 25;
  const editable = !batch || ["DRAFT", "READY", "REVIEW"].includes(batch.status);

  const patchItem = (key: string, patch: Partial<UploadItem>) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));

  // Upload queue: at most PARALLEL requests in flight; each completion pulls the next file.
  function pump() {
    while (activeRef.current < PARALLEL && queueRef.current.length) {
      const item = queueRef.current.shift()!;
      activeRef.current++;
      patchItem(item.key, { state: "uploading" });
      uploadOne(id, item, (p) => patchItem(item.key, { progress: p })).then((res) => {
        activeRef.current--;
        if (res.error) patchItem(item.key, { state: "error", error: res.error, progress: 100 });
        else {
          patchItem(item.key, { state: "done", progress: 100, duplicate: res.duplicate });
          if (res.duplicate) toast.warning(`Duplicate filename: ${item.file.name}`);
        }
        qc.invalidateQueries({ queryKey: qk.images(id) });
        qc.invalidateQueries({ queryKey: qk.batch(id) });
        pump();
      });
    }
  }

  const addFiles = (files: FileList | File[]) => {
    const existingNames = new Set((images ?? []).map((i) => i.originalFilename.toLowerCase()));
    const newItems: UploadItem[] = [];
    for (const file of Array.from(files)) {
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`;
      let error: string | undefined;
      if (!ACCEPT_EXT.test(file.name) && !file.type.startsWith("image/"))
        error = `${file.name}: unsupported file type — use JPG, PNG, WEBP or HEIC`;
      else if (file.size > maxMb * 1024 * 1024)
        error = `${file.name}: ${(file.size / 1024 / 1024).toFixed(1)} MB exceeds the ${maxMb} MB limit`;
      const duplicate = existingNames.has(file.name.toLowerCase());
      existingNames.add(file.name.toLowerCase());
      const item: UploadItem = { key, file, progress: 0, state: error ? "error" : "pending", error, duplicate };
      newItems.push(item);
      if (!error) queueRef.current.push(item);
    }
    setItems((prev) => [...newItems, ...prev]);
    pump();
  };

  const saveMeta = async (data: Record<string, unknown>) => {
    try {
      await apiSend(`/api/batches/${id}`, "PATCH", data);
      qc.invalidateQueries({ queryKey: qk.batch(id) });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = async (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const next = arrayMove(order, order.indexOf(String(e.active.id)), order.indexOf(String(e.over.id)));
    setPendingOrder(next);
    try {
      await apiSend(`/api/batches/${id}/images/reorder`, "POST", { ids: next });
      await qc.invalidateQueries({ queryKey: qk.images(id) });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setPendingOrder(null);
    }
  };

  const removeImage = async (imageId: string) => {
    try {
      await apiSend(`/api/images/${imageId}`, "DELETE");
      qc.invalidateQueries({ queryKey: qk.images(id) });
      qc.invalidateQueries({ queryKey: qk.batch(id) });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const [smartFilling, setSmartFilling] = useState(false);
  const smartFill = async () => {
    setSmartFilling(true);
    try {
      const r = await apiSend<{ filled: number }>(`/api/batches/${id}/smart-fill`, "POST", { overwrite: true });
      toast.success(`Filled details for ${r.filled} image${r.filled === 1 ? "" : "s"}`);
      qc.invalidateQueries({ queryKey: qk.images(id) });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSmartFilling(false);
    }
  };

  const uploading = items.some((i) => i.state === "uploading" || i.state === "pending");
  const visibleItems = items.filter((i) => i.state !== "done" || i.duplicate);
  const imageCount = images?.length ?? 0;

  return (
    <>
      <div className="mx-auto max-w-7xl space-y-6 p-6">
        <Card>
          <CardHeader>
            <CardTitle>Batch details</CardTitle>
          </CardHeader>
          <CardContent>
            {batch ? (
              <div className="grid gap-4 md:grid-cols-4">
                <div className="space-y-1.5 md:col-span-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    defaultValue={batch.name}
                    key={batch.id + batch.name}
                    onBlur={(e) =>
                      e.target.value.trim() &&
                      e.target.value !== batch.name &&
                      saveMeta({ name: e.target.value.trim() })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Brand</Label>
                  <Select value={batch.brand} onValueChange={(v) => saveMeta({ brand: v })}>
                    <SelectTrigger aria-label="Brand">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from(new Set([...(app?.brandList ?? []), batch.brand])).map((b) => (
                        <SelectItem key={b} value={b}>
                          {b}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tags">Tags</Label>
                  <Input
                    id="tags"
                    placeholder="spring, boots"
                    defaultValue={batch.tags.join(", ")}
                    key={batch.id + batch.tags.join()}
                    onBlur={(e) =>
                      saveMeta({
                        tags: e.target.value
                          .split(",")
                          .map((t) => t.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                </div>
                <div className="space-y-1.5 md:col-span-4">
                  <Label htmlFor="desc">Description</Label>
                  <Textarea
                    id="desc"
                    rows={2}
                    defaultValue={batch.description ?? ""}
                    key={batch.id + "d"}
                    onBlur={(e) =>
                      e.target.value !== (batch.description ?? "") && saveMeta({ description: e.target.value })
                    }
                  />
                </div>
              </div>
            ) : (
              <Skeleton className="h-24 w-full" />
            )}
          </CardContent>
        </Card>

        {editable && (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
            }}
            onClick={() => fileInput.current?.click()}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed bg-card px-6 py-14 text-center transition-colors",
              dragOver ? "border-primary bg-accent" : "border-gray-300 hover:border-primary/60",
            )}
            data-testid="dropzone"
          >
            <Upload className="size-10 text-primary" />
            <div>
              <p className="text-base font-medium">Drag & drop product photos here</p>
              <p className="text-sm text-muted-foreground">
                or click to choose files · JPG, PNG, WEBP, HEIC · up to {maxMb} MB each · 100–200 per batch
              </p>
            </div>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
              className="hidden"
              data-testid="file-input"
              onChange={(e) => {
                if (e.target.files?.length) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
        )}

        {visibleItems.length > 0 && (
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-sm">Uploads</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setItems((p) => p.filter((i) => i.state === "uploading" || i.state === "pending"))}
              >
                Clear finished
              </Button>
            </CardHeader>
            <CardContent className="max-h-64 space-y-2 overflow-y-auto">
              {visibleItems.map((it) => (
                <div key={it.key} className="flex items-center gap-3 text-sm">
                  <span className="w-64 truncate" title={it.file.name}>
                    {it.file.name}
                  </span>
                  {it.state === "error" ? (
                    <span className="flex-1 text-destructive">{it.error}</span>
                  ) : (
                    <Progress value={it.progress} className="flex-1" />
                  )}
                  {it.duplicate && it.state !== "error" && (
                    <Badge variant="amber">
                      <AlertTriangle /> Duplicate name
                    </Badge>
                  )}
                  {it.state === "uploading" && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
                  {it.state === "error" && (
                    <button
                      onClick={() => setItems((p) => p.filter((x) => x.key !== it.key))}
                      aria-label="Dismiss"
                      className="cursor-pointer"
                    >
                      <X className="size-4 text-muted-foreground" />
                    </button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">
            {imageCount} image{imageCount === 1 ? "" : "s"}
            {imageCount > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                Drag to reorder · click to edit details
              </span>
            )}
          </h2>
          <Button variant="outline" onClick={smartFill} disabled={!imageCount || smartFilling}>
            {smartFilling ? <Loader2 className="animate-spin" /> : <Wand2 />} Smart fill from filenames
          </Button>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square" />
            ))}
          </div>
        ) : imageCount === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border bg-card py-12 text-muted-foreground">
            <ImagePlus className="size-8" />
            No images yet
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={order} strategy={rectSortingStrategy}>
              <div
                className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
                data-testid="image-grid"
              >
                {order.map((imageId) => {
                  const img = byId.get(imageId);
                  return img ? (
                    <SortableThumb
                      key={imageId}
                      image={img}
                      onClick={() => setEditing(img)}
                      onRemove={() => removeImage(imageId)}
                      disabled={!editable}
                    />
                  ) : null;
                })}
              </div>
            </SortableContext>
          </DndContext>
        )}

        <MetadataDialog image={editing} onClose={() => setEditing(null)} batchId={id} />
      </div>
      <StickyBar>
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {uploading ? "Uploading…" : `${imageCount} image${imageCount === 1 ? "" : "s"} ready`}
          </span>
          <Button
            onClick={() => router.push(`/batches/${id}/settings`)}
            disabled={imageCount < 1 || uploading}
            data-testid="continue-settings"
          >
            Continue to settings <ArrowRight />
          </Button>
        </div>
      </StickyBar>
    </>
  );
}

function SortableThumb({
  image,
  onClick,
  onRemove,
  disabled,
}: {
  image: ImageDTO;
  onClick: () => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: image.id,
    disabled,
  });
  const [confirm, setConfirm] = useState(false);
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "group relative overflow-hidden rounded-lg border bg-card shadow-xs",
        isDragging && "z-10 opacity-70 shadow-lg",
      )}
    >
      <button
        className="checkerboard block aspect-square w-full cursor-pointer"
        onClick={onClick}
        {...attributes}
        {...listeners}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.originalThumbUrl ?? ""}
          alt={image.originalFilename}
          className="size-full object-contain"
          loading="lazy"
        />
      </button>
      <span className="absolute top-1.5 left-1.5 rounded bg-white/80 p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100">
        <GripVertical className="size-4" />
      </span>
      {!disabled && (
        <button
          onClick={() => setConfirm(true)}
          className="absolute top-1.5 right-1.5 cursor-pointer rounded bg-white/90 p-1 text-muted-foreground opacity-0 shadow group-hover:opacity-100 hover:text-destructive"
          aria-label={`Remove ${image.originalFilename}`}
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
      <div className="space-y-0.5 p-2 text-xs">
        <p className="truncate font-medium" title={image.originalFilename}>
          {image.originalFilename}
        </p>
        <p className="text-muted-foreground">
          {image.originalWidth}×{image.originalHeight} · {formatBytesKb(image.originalSizeKb)}
        </p>
        <p className="truncate text-muted-foreground">
          {[image.styleCode, image.colorName, image.viewAngle?.toLowerCase()].filter(Boolean).join(" · ") || "—"}
        </p>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Remove image?"
        description={`${image.originalFilename} will be removed from this batch.`}
        confirmLabel="Remove"
        destructive
        onConfirm={onRemove}
      />
    </div>
  );
}

function MetadataDialog({ image, onClose, batchId }: { image: ImageDTO | null; onClose: () => void; batchId: string }) {
  return (
    <Dialog open={!!image} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {image && <MetadataForm key={image.id} image={image} onClose={onClose} batchId={batchId} />}
      </DialogContent>
    </Dialog>
  );
}

function MetadataForm({ image, onClose, batchId }: { image: ImageDTO; onClose: () => void; batchId: string }) {
  const qc = useQueryClient();
  const [style, setStyle] = useState(image.styleCode ?? "");
  const [color, setColor] = useState(image.colorName ?? "");
  const [view, setView] = useState<string>(image.viewAngle ?? "");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await apiSend(`/api/images/${image.id}`, "PATCH", {
        styleCode: style || null,
        colorName: color || null,
        viewAngle: view || null,
      });
      qc.invalidateQueries({ queryKey: qk.images(batchId) });
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle className="truncate">{image.originalFilename}</DialogTitle>
      </DialogHeader>
      <div className="checkerboard h-48 overflow-hidden rounded-md border">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.originalThumbUrl ?? ""} alt="" className="size-full object-contain" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="style">Style code</Label>
          <Input id="style" value={style} onChange={(e) => setStyle(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="color">Color</Label>
          <Input id="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>View</Label>
          <Select value={view || "none"} onValueChange={(v) => setView(v === "none" ? "" : v)}>
            <SelectTrigger aria-label="View angle">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">—</SelectItem>
              {VIEWS.map((v) => (
                <SelectItem key={v} value={v}>
                  {v.charAt(0) + v.slice(1).toLowerCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="animate-spin" />} Save
        </Button>
      </DialogFooter>
    </>
  );
}
