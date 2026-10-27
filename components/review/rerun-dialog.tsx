"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { apiSend } from "@/lib/client/api";
import { useConfig } from "@/lib/client/hooks";
import type { Estimate } from "@/lib/estimate";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { formatCents } from "@/lib/utils";

/** Re-run AI on one or more images with an optional shared instruction, after showing the cost. */
export function RerunDialog({
  open,
  onOpenChange,
  batchId,
  ids,
  initialInstruction = "",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  batchId: string;
  ids: string[];
  initialInstruction?: string;
  onConfirm: (instruction: string | null) => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open && (
          <RerunForm
            batchId={batchId}
            ids={ids}
            initialInstruction={initialInstruction}
            onConfirm={onConfirm}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RerunForm({
  batchId,
  ids,
  initialInstruction,
  onConfirm,
  onCancel,
}: {
  batchId: string;
  ids: string[];
  initialInstruction: string;
  onConfirm: (instruction: string | null) => Promise<void>;
  onCancel: () => void;
}) {
  const [instruction, setInstruction] = useState(initialInstruction);
  const [busy, setBusy] = useState(false);
  const local = useConfig().data?.localMode ?? false;
  const { data: estimate } = useQuery({
    queryKey: ["rerun-estimate", batchId, ids.join(","), instruction],
    queryFn: async () =>
      (
        await apiSend<{ estimate: Estimate }>(`/api/batches/${batchId}/estimate`, "POST", {
          ids,
          instruction: instruction.trim() || null,
        })
      ).estimate,
  });
  // A forced re-run never reuses the cache, so every image is a new call.
  const calls = ids.length;
  const perCall =
    estimate && estimate.aiCalls + estimate.bgRemovalCalls > 0
      ? estimate.estimatedCostCents / (estimate.aiCalls + estimate.bgRemovalCalls)
      : null;
  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" /> Re-run AI on {ids.length} image{ids.length === 1 ? "" : "s"}
        </DialogTitle>
        <DialogDescription>The instruction is added to the batch’s AI edits for these images only.</DialogDescription>
      </DialogHeader>
      <Textarea
        autoFocus
        maxLength={500}
        rows={3}
        placeholder="Optional, e.g. “Remove the reflection on the toe cap”"
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        aria-label="Re-run instruction"
      />
      {local ? (
        <div className="rounded-md bg-muted p-3 text-sm">
          Re-runs the local edits on {calls} image{calls === 1 ? "" : "s"} — free.{" "}
          <span className="text-amber-700">Text instructions need a cloud AI provider and are ignored locally.</span>
        </div>
      ) : (
        <div className="rounded-md bg-muted p-3 text-sm">
          This will use{" "}
          <span className="font-semibold">
            {calls} AI call{calls === 1 ? "" : "s"}
          </span>
          {perCall != null && (
            <>
              {" "}
              (est. <span className="font-semibold">{formatCents(Math.round(perCall * calls))}</span>)
            </>
          )}
          .
        </div>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm(instruction.trim() || null);
              onCancel();
            } finally {
              setBusy(false);
            }
          }}
          data-testid="confirm-rerun"
        >
          {busy && <Loader2 className="animate-spin" />} Re-run AI ({calls} call{calls === 1 ? "" : "s"})
        </Button>
      </DialogFooter>
    </>
  );
}
