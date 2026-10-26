"use client";
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, Info, Loader2, Pause, Play, RotateCcw, Square } from "lucide-react";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";
import { qk } from "@/lib/client/hooks";
import type { Progress as ProgressData } from "@/lib/progress";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { ImageStatusBadge } from "@/components/status-badge";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { cn, formatDuration } from "@/lib/utils";

const ACTIVE = new Set(["PROCESSING", "PAUSED"]);

export default function ProcessingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [redirectIn, setRedirectIn] = useState<number | null>(null);
  const prevStatus = useRef<string | null>(null);

  const { data: progress, isLoading } = useQuery({
    queryKey: qk.progress(id),
    queryFn: () => apiGet<ProgressData>(`/api/batches/${id}/progress`),
    refetchInterval: (q) =>
      q.state.data && !ACTIVE.has(q.state.data.status) && q.state.data.remaining === 0 ? false : 1500,
  });

  // Completion: toast + auto-navigate to Review after 3 s.
  useEffect(() => {
    if (!progress) return;
    const was = prevStatus.current;
    prevStatus.current = progress.status;
    if (was === "PROCESSING" && progress.status === "REVIEW") {
      toast.success(`Batch finished — ${progress.counts.DONE} done, ${progress.counts.FAILED} failed`);
      qc.invalidateQueries({ queryKey: qk.batch(id) });
      let n = 3;
      const tick = () => {
        setRedirectIn(n);
        if (n === 0) router.push(`/batches/${id}/review`);
        else {
          n--;
          timer = setTimeout(tick, 1000);
        }
      };
      let timer = setTimeout(tick, 0);
      return () => clearTimeout(timer);
    }
  }, [progress, id, qc, router]);

  const act = async (action: "pause" | "resume" | "cancel") => {
    setBusy(action);
    try {
      await apiSend(`/api/batches/${id}/${action}`, "POST");
      await qc.invalidateQueries({ queryKey: qk.progress(id) });
      qc.invalidateQueries({ queryKey: qk.batch(id) });
      if (action === "cancel") toast("Batch cancelled — finished images were kept");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const retryFailed = async () => {
    setBusy("retry");
    try {
      const r = await apiSend<{ queued: number }>(`/api/batches/${id}/retry-failed`, "POST");
      toast.success(`Re-queued ${r.queued} failed image(s)`);
      qc.invalidateQueries({ queryKey: qk.progress(id) });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  if (isLoading || !progress) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-32" />
        <div className="grid grid-cols-3 gap-3 md:grid-cols-6 lg:grid-cols-8">
          {Array.from({ length: 16 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square" />
          ))}
        </div>
      </div>
    );
  }

  const c = progress.counts;
  const inFlight = c.PROCESSING_AI + c.PROCESSING_STANDARD;

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-6">
      {ACTIVE.has(progress.status) && (
        <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-900">
          <Info className="size-4 shrink-0" /> Processing continues on the server even if you close this tab. Come back
          any time.
        </div>
      )}

      <Card>
        <CardContent className="space-y-4 pt-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-3xl font-semibold tabular-nums" data-testid="progress-percent">
                {progress.percent}%
              </p>
              <p className="text-sm text-muted-foreground">
                {progress.finished} of {progress.total} images ·{" "}
                {progress.status === "PAUSED" ? "paused" : progress.status.toLowerCase()}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {progress.status === "PROCESSING" && (
                <Button variant="outline" onClick={() => act("pause")} disabled={!!busy}>
                  {busy === "pause" ? <Loader2 className="animate-spin" /> : <Pause />} Pause
                </Button>
              )}
              {progress.status === "PAUSED" && (
                <Button onClick={() => act("resume")} disabled={!!busy}>
                  {busy === "resume" ? <Loader2 className="animate-spin" /> : <Play />} Resume
                </Button>
              )}
              {ACTIVE.has(progress.status) && (
                <Button
                  variant="outline"
                  className="text-destructive"
                  onClick={() => setConfirmCancel(true)}
                  disabled={!!busy}
                >
                  <Square /> Cancel
                </Button>
              )}
              {!ACTIVE.has(progress.status) && c.FAILED > 0 && (
                <Button variant="outline" onClick={retryFailed} disabled={!!busy}>
                  <RotateCcw /> Retry {c.FAILED} failed
                </Button>
              )}
              {!ACTIVE.has(progress.status) && (
                <Button onClick={() => router.push(`/batches/${id}/review`)}>
                  Go to review <ArrowRight />
                </Button>
              )}
            </div>
          </div>
          <Progress value={progress.percent} className="h-3" />
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Queued" value={c.QUEUED} />
            <Stat label="In progress" value={inFlight} />
            <Stat label="Done" value={c.DONE + c.APPROVED + c.REJECTED} />
            <Stat label="Failed" value={c.FAILED} tone={c.FAILED ? "red" : undefined} />
            <Stat label="Elapsed" value={formatDuration(progress.elapsedSeconds)} />
            <Stat label="ETA" value={progress.remaining === 0 ? "—" : formatDuration(progress.etaSeconds)} />
          </div>
          <p className="text-xs text-muted-foreground">
            AI calls used: {progress.aiCallsUsed}
            {progress.avgSecondsPerImage != null && ` · ${progress.avgSecondsPerImage.toFixed(1)} s per image`}
            {redirectIn != null && ` · opening review in ${redirectIn}s…`}
          </p>
        </CardContent>
      </Card>

      <div
        className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8"
        data-testid="processing-grid"
      >
        {progress.images.map((img) => {
          const working = img.status === "PROCESSING_AI" || img.status === "PROCESSING_STANDARD";
          return (
            <div
              key={img.id}
              className={cn("overflow-hidden rounded-lg border bg-card", img.status === "FAILED" && "border-red-300")}
              title={img.errorMessage ?? img.filename}
            >
              <div className="checkerboard relative aspect-square">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.thumbUrl ?? ""}
                  alt={img.filename}
                  className={cn("size-full object-contain", img.status === "QUEUED" && "opacity-50")}
                  loading="lazy"
                />
                {working && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/40">
                    <Loader2 className="size-6 animate-spin text-blue-600" />
                  </div>
                )}
              </div>
              <div className="space-y-1 p-1.5">
                <ImageStatusBadge status={img.status} needsReview={img.needsReview} />
                {img.retrying && <p className="text-[10px] text-amber-700">retrying…</p>}
                {img.status === "FAILED" && (
                  <p className="line-clamp-2 text-[10px] text-destructive">{img.errorMessage}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancel processing?"
        description="Images already finished are kept. Images still queued won't be processed. Images currently being edited will finish."
        confirmLabel="Cancel batch"
        destructive
        onConfirm={() => act("cancel")}
      />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "red" }) {
  return (
    <div className="rounded-md bg-muted/70 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("font-semibold tabular-nums", tone === "red" && "text-destructive")}>{value}</p>
    </div>
  );
}
