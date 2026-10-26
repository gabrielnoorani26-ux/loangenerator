"use client";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Download, Grid2x2, Grid3x3, LayoutGrid, Loader2, RefreshCw, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { apiSend, errorMessage } from "@/lib/client/api";
import { qk, useBatch, useImages } from "@/lib/client/hooks";
import type { ImageDTO } from "@/lib/batches";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ImageStatusBadge, QcBadge } from "@/components/status-badge";
import { ImageDetail } from "@/components/review/image-detail";
import { RerunDialog } from "@/components/review/rerun-dialog";
import { ExportDialog } from "@/components/review/export-dialog";
import { cn } from "@/lib/utils";

type Filter = "all" | "review" | "done" | "approved" | "rejected" | "failed";
type Sort = "order" | "qc" | "filename";
type Size = "s" | "m" | "l";

const PROCESSING = new Set(["QUEUED", "PROCESSING_AI", "PROCESSING_STANDARD"]);

function matches(img: ImageDTO, f: Filter): boolean {
  switch (f) {
    case "all":
      return true;
    case "review":
      return img.needsReview;
    case "done":
      return img.status === "DONE";
    case "approved":
      return img.status === "APPROVED";
    case "rejected":
      return img.status === "REJECTED";
    case "failed":
      return img.status === "FAILED";
  }
}

export default function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data: batch } = useBatch(id);
  const { data: images, isLoading } = useImages(id, { pollWhileProcessing: true });
  const anyProcessing = !!images?.some((i) => PROCESSING.has(i.status));

  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("order");
  const [size, setSize] = useState<Size>("m");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [rerunOpen, setRerunOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c = { all: 0, review: 0, done: 0, approved: 0, rejected: 0, failed: 0 } as Record<Filter, number>;
    for (const i of images ?? []) for (const f of Object.keys(c) as Filter[]) if (matches(i, f)) c[f]++;
    return c;
  }, [images]);

  const visible = useMemo(() => {
    const list = (images ?? []).filter((i) => matches(i, filter));
    if (sort === "qc") list.sort((a, b) => (a.qcScore ?? 101) - (b.qcScore ?? 101));
    else if (sort === "filename") list.sort((a, b) => (a.outputFilename ?? a.originalFilename).localeCompare(b.outputFilename ?? b.originalFilename));
    return list;
  }, [images, filter, sort]);

  const openIndex = openId ? visible.findIndex((i) => i.id === openId) : -1;
  const openImage = openIndex >= 0 ? visible[openIndex] : openId ? (images?.find((i) => i.id === openId) ?? null) : null;
  const selectedIds = [...selected].filter((sid) => images?.some((i) => i.id === sid));

  const refresh = () => {
    qc.invalidateQueries({ queryKey: qk.images(id) });
    qc.invalidateQueries({ queryKey: qk.batch(id) });
  };
  const bulk = async (action: string, extra: Record<string, unknown> = {}, ids = selectedIds, msg?: (n: number) => string) => {
    setBusy(action);
    try {
      const r = await apiSend<{ affected: number }>(`/api/batches/${id}/images/bulk`, "POST", { action, ids, ...extra });
      if (msg) toast.success(msg(r.affected));
      if (action === "delete") setSelected(new Set());
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const quick = async (imageId: string, action: "approve" | "reject") => {
    try {
      await apiSend(`/api/images/${imageId}/${action}`, "POST");
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const retryFailed = async () => {
    setBusy("retry");
    try {
      const r = await apiSend<{ queued: number }>(`/api/batches/${id}/retry-failed`, "POST");
      toast.success(`Re-queued ${r.queued} failed image(s)`);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const toggle = (imgId: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(imgId)) n.delete(imgId);
      else n.add(imgId);
      return n;
    });
  const allVisibleSelected = visible.length > 0 && visible.every((i) => selected.has(i.id));

  const gridCols = size === "s" ? "grid-cols-3 sm:grid-cols-5 md:grid-cols-7 lg:grid-cols-9" : size === "m" ? "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
  const total = images?.length ?? 0;
  const approvalRate = total ? Math.round((counts.approved / total) * 100) : 0;

  return (
    <div className="mx-auto max-w-[1600px] space-y-4 p-4 md:p-6">
      {/* Stats bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <Stat label="Images" value={total} />
          <Stat label="Needs review" value={counts.review} tone="amber" />
          <Stat label="Approved" value={`${counts.approved} (${approvalRate}%)`} tone="green" />
          <Stat label="Rejected" value={counts.rejected} />
          <Stat label="Failed" value={counts.failed} tone={counts.failed ? "red" : undefined} />
          <Stat label="AI calls used" value={batch?.aiCallsUsed ?? "—"} />
          {anyProcessing && (
            <span className="flex items-center gap-1.5 text-blue-700">
              <Loader2 className="size-3.5 animate-spin" /> processing re-runs…
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {counts.failed > 0 && (
            <Button variant="outline" onClick={retryFailed} disabled={!!busy}>
              <RotateCcw /> Retry all failed
            </Button>
          )}
          <Button onClick={() => setExportOpen(true)} data-testid="open-export">
            <Download /> Export
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList className="h-auto flex-wrap">
            {(
              [
                ["all", "All"],
                ["review", "Needs Review"],
                ["done", "Done"],
                ["approved", "Approved"],
                ["rejected", "Rejected"],
                ["failed", "Failed"],
              ] as [Filter, string][]
            ).map(([f, l]) => (
              <TabsTrigger key={f} value={f}>
                {l} <span className="text-xs text-muted-foreground">{counts[f]}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
            <SelectTrigger className="w-40" aria-label="Sort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="order">Batch order</SelectItem>
              <SelectItem value="qc">QC low → high</SelectItem>
              <SelectItem value="filename">Filename</SelectItem>
            </SelectContent>
          </Select>
          <ToggleGroup type="single" value={size} onValueChange={(v) => v && setSize(v as Size)} aria-label="Thumbnail size" className="hidden sm:inline-flex">
            <ToggleGroupItem value="s" aria-label="Small thumbnails">
              <Grid3x3 />
            </ToggleGroupItem>
            <ToggleGroupItem value="m" aria-label="Medium thumbnails">
              <Grid2x2 />
            </ToggleGroupItem>
            <ToggleGroupItem value="l" aria-label="Large thumbnails">
              <LayoutGrid />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedIds.length > 0 && (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-accent px-3 py-2 shadow-sm" data-testid="bulk-bar">
          <span className="mr-2 text-sm font-medium">{selectedIds.length} selected</span>
          <Button size="sm" variant="success" disabled={!!busy} onClick={() => bulk("approve", {}, selectedIds, (n) => `Approved ${n}`)}>
            <Check /> Approve
          </Button>
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => bulk("reject", {}, selectedIds, (n) => `Rejected ${n}`)}>
            <X /> Reject
          </Button>
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => setRerunOpen(true)}>
            <Sparkles /> Re-run AI
          </Button>
          <Button size="sm" variant="outline" disabled={!!busy} onClick={() => bulk("reapply-standard", {}, selectedIds, (n) => `Re-applying standard edits on ${n} (no AI cost)`)}>
            <RefreshCw /> Re-apply standard
          </Button>
          <Button size="sm" variant="outline" className="text-destructive" disabled={!!busy} onClick={() => setConfirmDelete(true)}>
            <Trash2 /> Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Checkbox
          checked={allVisibleSelected ? true : selected.size ? "indeterminate" : false}
          onCheckedChange={() => setSelected(allVisibleSelected ? new Set() : new Set(visible.map((i) => i.id)))}
          aria-label="Select all visible"
        />
        Select all {visible.length} shown
      </div>

      {isLoading ? (
        <div className={cn("grid gap-3", gridCols)}>
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border bg-card py-16 text-center text-muted-foreground">No images in this view.</div>
      ) : (
        <div className={cn("grid gap-3", gridCols)} data-testid="review-grid">
          {visible.map((img) => (
            <ReviewCard
              key={img.id}
              image={img}
              selected={selected.has(img.id)}
              onToggle={() => toggle(img.id)}
              onOpen={() => setOpenId(img.id)}
              onApprove={() => quick(img.id, "approve")}
              onReject={() => quick(img.id, "reject")}
              compact={size === "s"}
            />
          ))}
        </div>
      )}

      <ImageDetail
        image={openImage}
        batchId={id}
        settings={batch?.snapshot ?? batch?.settings ?? null}
        onClose={() => setOpenId(null)}
        onPrev={() => visible.length && setOpenId(visible[(openIndex - 1 + visible.length) % visible.length].id)}
        onNext={() => visible.length && setOpenId(visible[(openIndex + 1) % visible.length].id)}
        position={openIndex >= 0 ? `${openIndex + 1} / ${visible.length}` : ""}
      />
      <RerunDialog
        open={rerunOpen}
        onOpenChange={setRerunOpen}
        batchId={id}
        ids={selectedIds}
        onConfirm={async (instruction) => {
          await bulk("rerun-ai", { instruction }, selectedIds, (n) => `AI re-run queued for ${n} image(s)`);
        }}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${selectedIds.length} image(s)?`}
        description="They will be removed from this batch along with their edited versions."
        confirmLabel="Delete"
        destructive
        onConfirm={() => bulk("delete", {}, selectedIds, (n) => `Deleted ${n}`)}
      />
      {exportOpen && batch && images && (
        <ExportDialog open={exportOpen} onOpenChange={setExportOpen} batchId={id} batchStatus={batch.status} images={images} selectedIds={selectedIds} />
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "amber" | "green" | "red" }) {
  return (
    <span>
      <span className="text-muted-foreground">{label}: </span>
      <span className={cn("font-semibold tabular-nums", tone === "amber" && "text-amber-700", tone === "green" && "text-emerald-700", tone === "red" && "text-destructive")}>
        {value}
      </span>
    </span>
  );
}

function ReviewCard({
  image,
  selected,
  onToggle,
  onOpen,
  onApprove,
  onReject,
  compact,
}: {
  image: ImageDTO;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onApprove: () => void;
  onReject: () => void;
  compact: boolean;
}) {
  const processing = PROCESSING.has(image.status);
  const reviewable = image.status === "DONE" || image.status === "APPROVED" || image.status === "REJECTED";
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-lg border bg-card shadow-xs transition-shadow hover:shadow-md",
        selected && "ring-2 ring-primary",
        image.status === "APPROVED" && "border-emerald-300",
        image.status === "REJECTED" && "border-red-300 opacity-75",
        image.status === "FAILED" && "border-red-400 border-dashed",
        image.needsReview && "border-amber-300",
      )}
      data-testid="review-card"
    >
      <button className="checkerboard relative block aspect-square w-full cursor-zoom-in" onClick={onOpen} aria-label={`Open ${image.outputFilename ?? image.originalFilename}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={(image.editedThumbUrl ?? image.originalThumbUrl) || ""} alt="" className="size-full object-contain" loading="lazy" />
        {processing && (
          <span className="absolute inset-0 flex items-center justify-center bg-white/50">
            <Loader2 className="size-6 animate-spin text-blue-600" />
          </span>
        )}
      </button>
      <div className="absolute top-2 left-2">
        <Checkbox checked={selected} onCheckedChange={onToggle} aria-label="Select image" className="bg-white/90" />
      </div>
      <div className="absolute top-2 right-2 flex gap-1">
        <QcBadge score={image.qcScore} />
      </div>
      {!compact && (
        <div className="space-y-1.5 p-2">
          <p className="truncate text-xs font-medium" title={image.outputFilename ?? image.originalFilename}>
            {image.outputFilename ?? image.originalFilename}
          </p>
          <div className="flex items-center justify-between gap-1">
            <ImageStatusBadge status={image.status} needsReview={image.needsReview} />
            {reviewable && (
              <div className="flex gap-1">
                <Button size="icon-sm" variant="ghost" className="size-7 text-emerald-700 hover:bg-emerald-50" onClick={onApprove} aria-label="Approve" disabled={image.status === "APPROVED"}>
                  <Check />
                </Button>
                <Button size="icon-sm" variant="ghost" className="size-7 text-destructive hover:bg-red-50" onClick={onReject} aria-label="Reject" disabled={image.status === "REJECTED"}>
                  <X />
                </Button>
              </div>
            )}
          </div>
          {image.status === "FAILED" && image.errorMessage && <p className="line-clamp-2 text-[11px] text-destructive">{image.errorMessage}</p>}
        </div>
      )}
    </div>
  );
}
