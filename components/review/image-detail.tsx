"use client";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  History,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";
import { qk } from "@/lib/client/hooks";
import type { ImageDTO } from "@/lib/batches";
import { listEdits } from "@/lib/summary";
import type { EditSettings } from "@/lib/settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ImageStatusBadge, QcBadge } from "@/components/status-badge";
import { ZoomCompare, type CompareMode } from "@/components/zoom-compare";
import { RerunDialog } from "./rerun-dialog";
import { formatBytesKb, formatDate } from "@/lib/utils";

const VIEWS = ["SIDE", "FRONT", "BACK", "TOP", "SOLE", "PAIR", "DETAIL", "LIFESTYLE", "OTHER"] as const;

interface Version {
  id: string;
  editedUrl: string;
  thumbUrl: string;
  instruction: string | null;
  qcScore: number | null;
  outputWidth: number | null;
  outputHeight: number | null;
  outputSizeKb: number | null;
  createdAt: string;
}

export function ImageDetail({
  image,
  batchId,
  settings,
  onClose,
  onPrev,
  onNext,
  position,
}: {
  image: ImageDTO | null;
  batchId: string;
  settings: EditSettings | null;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  position: string;
}) {
  return (
    <Dialog open={!!image} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="h-[92vh] w-[96vw] max-w-[1500px] grid-rows-[auto_1fr_auto] gap-3 p-4"
        showClose={false}
        aria-describedby={undefined}
      >
        {image && (
          <DetailBody
            key={image.id}
            image={image}
            batchId={batchId}
            settings={settings}
            onClose={onClose}
            onPrev={onPrev}
            onNext={onNext}
            position={position}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailBody({
  image,
  batchId,
  settings,
  onClose,
  onPrev,
  onNext,
  position,
}: {
  image: ImageDTO;
  batchId: string;
  settings: EditSettings | null;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  position: string;
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<CompareMode>("slider");
  const [busy, setBusy] = useState<string | null>(null);
  const [rerunOpen, setRerunOpen] = useState(false);
  const [style, setStyle] = useState(image.styleCode ?? "");
  const [color, setColor] = useState(image.colorName ?? "");

  const { data: detail } = useQuery({
    queryKey: ["image-detail", image.id, image.updatedAt],
    queryFn: () => apiGet<{ versions: Version[] }>(`/api/images/${image.id}`),
  });
  const versions = detail?.versions ?? [];
  const processing = ["QUEUED", "PROCESSING_AI", "PROCESSING_STANDARD"].includes(image.status);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: qk.images(batchId) });
    qc.invalidateQueries({ queryKey: qk.batch(batchId) });
  };
  const run = async (key: string, fn: () => Promise<unknown>, success?: string) => {
    setBusy(key);
    try {
      await fn();
      if (success) toast.success(success);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const approve = () => run("approve", () => apiSend(`/api/images/${image.id}/approve`, "POST")).then(onNext);
  const reject = () => run("reject", () => apiSend(`/api/images/${image.id}/reject`, "POST")).then(onNext);
  const saveMeta = (data: Record<string, unknown>) =>
    run("meta", () => apiSend(`/api/images/${image.id}`, "PATCH", data));

  // Keyboard: ←/→ navigate, A approve, R reject, Space toggle before/after, Esc close (Radix).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable], [role=dialog] [role=dialog]") || rerunOpen) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft") onPrev();
      else if (e.key === "ArrowRight") onNext();
      else if ((e.key === "a" || e.key === "A") && !busy && reviewable(image)) approve();
      else if ((e.key === "r" || e.key === "R") && !busy && reviewable(image)) reject();
      else if (e.key === " ") {
        e.preventDefault();
        setMode((m) => (m === "original" ? "edited" : "original"));
      } else return;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const edits = settings ? listEdits(settings) : null;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 pr-1">
        <div className="flex min-w-0 items-center gap-2">
          <Button size="icon-sm" variant="outline" onClick={onPrev} aria-label="Previous image">
            <ChevronLeft />
          </Button>
          <Button size="icon-sm" variant="outline" onClick={onNext} aria-label="Next image">
            <ChevronRight />
          </Button>
          <DialogTitle className="truncate text-base">{image.outputFilename ?? image.originalFilename}</DialogTitle>
          <span className="text-xs text-muted-foreground">{position}</span>
          <ImageStatusBadge status={image.status} needsReview={image.needsReview} />
          <QcBadge score={image.qcScore} />
        </div>
        <div className="flex items-center gap-2">
          <ToggleGroup type="single" value={mode} onValueChange={(v) => v && setMode(v as CompareMode)}>
            <ToggleGroupItem value="slider">Slider</ToggleGroupItem>
            <ToggleGroupItem value="side">Side by side</ToggleGroupItem>
            <ToggleGroupItem value="original">Original</ToggleGroupItem>
            <ToggleGroupItem value="edited">Edited</ToggleGroupItem>
          </ToggleGroup>
          <Button size="icon-sm" variant="ghost" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 gap-4 lg:grid-cols-[1fr_320px]">
        <div className="relative min-h-0">
          <ZoomCompare before={image.originalUrl!} after={image.editedUrl} mode={mode} className="h-full" />
          {processing && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/60">
              <span className="flex items-center gap-2 rounded-md bg-white px-3 py-2 text-sm shadow">
                <Loader2 className="size-4 animate-spin" /> Processing…
              </span>
            </div>
          )}
        </div>

        <aside className="min-h-0 space-y-4 overflow-y-auto pr-1 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="success"
              onClick={approve}
              disabled={!!busy || !reviewable(image)}
              data-testid="detail-approve"
            >
              {busy === "approve" ? <Loader2 className="animate-spin" /> : <Check />} Approve
            </Button>
            <Button
              variant="outline"
              className="text-destructive"
              onClick={reject}
              disabled={!!busy || !reviewable(image)}
            >
              <X /> Reject
            </Button>
            <Button variant="outline" onClick={() => setRerunOpen(true)} disabled={!!busy || processing}>
              <Sparkles /> Re-run AI
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                run(
                  "std",
                  () => apiSend(`/api/images/${image.id}/reapply-standard`, "POST"),
                  "Re-applying standard edits (no AI cost)",
                )
              }
              disabled={!!busy || processing}
              title="Re-applies the batch's standard edits only — zero AI cost"
            >
              <RefreshCw /> Standard only
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                run(
                  "orig",
                  () => apiSend(`/api/images/${image.id}/use-original`, "POST", { useOriginal: !image.useOriginal }),
                  image.useOriginal ? "Using the AI result again" : "Using the original (standard edits only)",
                )
              }
              disabled={!!busy || processing}
            >
              <ImageIcon /> {image.useOriginal ? "Use AI result" : "Use original"}
            </Button>
            <Button variant="outline" asChild disabled={!image.editedUrl}>
              <a
                href={
                  image.editedUrl
                    ? `${image.editedUrl}?download=${encodeURIComponent(image.outputFilename ?? "image")}`
                    : undefined
                }
              >
                <Download /> Download
              </a>
            </Button>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-full justify-between" disabled={!versions.length || processing}>
                <span className="flex items-center gap-2">
                  <History /> Revert to version
                </span>
                <Badge variant="gray">{versions.length}</Badge>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="max-h-80 w-72 overflow-y-auto">
              <DropdownMenuLabel>Previous outputs</DropdownMenuLabel>
              {versions.map((v) => (
                <DropdownMenuItem
                  key={v.id}
                  onSelect={() =>
                    run(
                      "revert",
                      () => apiSend(`/api/images/${image.id}/revert`, "POST", { versionId: v.id }),
                      "Reverted",
                    )
                  }
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={v.thumbUrl} alt="" className="checkerboard size-12 rounded border object-contain" />
                  <span className="min-w-0 text-xs">
                    <span className="block">{new Date(v.createdAt).toLocaleString()}</span>
                    <span className="block truncate text-muted-foreground">{v.instruction ?? "batch settings"}</span>
                    {v.qcScore != null && <span className="text-muted-foreground">QC {v.qcScore}</span>}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {image.errorMessage && image.status === "FAILED" && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-800">{image.errorMessage}</div>
          )}

          {image.qcScore != null && (
            <section className="space-y-1">
              <h3 className="font-semibold">Automated QC</h3>
              <p>
                Score <span className="font-semibold">{image.qcScore}</span> ·{" "}
                {image.qcVerdict === "pass" ? "pass" : "needs review"}
              </p>
              {image.qcIssues.length > 0 && (
                <ul className="list-disc pl-5 text-muted-foreground">
                  {image.qcIssues.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className="space-y-1">
            <h3 className="font-semibold">Details</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-muted-foreground">
              <dt>Original</dt>
              <dd className="truncate" title={image.originalFilename}>
                {image.originalWidth}×{image.originalHeight} · {formatBytesKb(image.originalSizeKb)}
              </dd>
              <dt>Edited</dt>
              <dd>
                {image.outputWidth
                  ? `${image.outputWidth}×${image.outputHeight} · ${formatBytesKb(image.outputSizeKb)}`
                  : "—"}
              </dd>
              <dt>Source</dt>
              <dd>{image.useOriginal ? "Original (AI skipped)" : image.hasAiResult ? "AI result" : "Original"}</dd>
              {image.perImageInstruction && (
                <>
                  <dt>Instruction</dt>
                  <dd>{image.perImageInstruction}</dd>
                </>
              )}
              <dt>Updated</dt>
              <dd>{formatDate(image.updatedAt)}</dd>
            </dl>
          </section>

          {edits && (
            <section className="space-y-1">
              <h3 className="font-semibold">Edits applied</h3>
              <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                {(image.useOriginal ? [] : edits.ai).map((e) => (
                  <li key={e}>{e}</li>
                ))}
                {edits.standard.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </section>
          )}

          <section className="space-y-2">
            <h3 className="font-semibold">Metadata</h3>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="d-style">Style</Label>
                <Input
                  id="d-style"
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  onBlur={() => style !== (image.styleCode ?? "") && saveMeta({ styleCode: style || null })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="d-color">Color</Label>
                <Input
                  id="d-color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  onBlur={() => color !== (image.colorName ?? "") && saveMeta({ colorName: color || null })}
                />
              </div>
            </div>
            <Select
              value={image.viewAngle ?? "none"}
              onValueChange={(v) => saveMeta({ viewAngle: v === "none" ? null : v })}
            >
              <SelectTrigger aria-label="View angle">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">View —</SelectItem>
                {VIEWS.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v.charAt(0) + v.slice(1).toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Metadata changes apply to filenames on the next re-run (Standard only is free).
            </p>
          </section>
        </aside>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-xs text-muted-foreground">
        <Kbd k="← →">navigate</Kbd>
        <Kbd k="A">approve</Kbd>
        <Kbd k="R">reject</Kbd>
        <Kbd k="Space">toggle before/after</Kbd>
        <Kbd k="Esc">close</Kbd>
        <span>Scroll to zoom · drag to pan</span>
      </div>

      <RerunDialog
        open={rerunOpen}
        onOpenChange={setRerunOpen}
        batchId={batchId}
        ids={[image.id]}
        initialInstruction={image.perImageInstruction ?? ""}
        onConfirm={async (instruction) => {
          await run(
            "rerun",
            () => apiSend(`/api/images/${image.id}/rerun-ai`, "POST", { instruction }),
            "AI re-run queued",
          );
        }}
      />
    </>
  );
}

function reviewable(i: ImageDTO) {
  return i.status === "DONE" || i.status === "APPROVED" || i.status === "REJECTED";
}

function Kbd({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <span>
      <kbd className="rounded border bg-muted px-1 font-mono">{k}</kbd> {children}
    </span>
  );
}
