"use client";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Download, Loader2 } from "lucide-react";
import { apiGet, apiSend, errorMessage } from "@/lib/client/api";
import { qk } from "@/lib/client/hooks";
import type { ImageDTO } from "@/lib/batches";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

type Scope = "approved" | "done" | "selected";
type Group = "flat" | "style" | "view" | "color";

function folder(img: ImageDTO, group: Group): string {
  if (group === "flat") return "";
  const v = group === "style" ? img.styleCode : group === "view" ? img.viewAngle?.toLowerCase() : img.colorName;
  return `${(v ?? "").replace(/[^A-Za-z0-9._-]+/g, "_") || "unassigned"}/`;
}

export function ExportDialog({
  open,
  onOpenChange,
  batchId,
  batchStatus,
  images,
  selectedIds,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  batchId: string;
  batchStatus: string;
  images: ImageDTO[];
  selectedIds: string[];
}) {
  const qc = useQueryClient();
  const approvedCount = images.filter((i) => i.status === "APPROVED").length;
  const [scope, setScope] = useState<Scope>(approvedCount ? "approved" : "done");
  const [group, setGroup] = useState<Group>("flat");
  const [originals, setOriginals] = useState(false);
  const [manifest, setManifest] = useState(true);
  const [state, setState] = useState<{ part: number; parts: number; mb: number } | null>(null);
  const [finished, setFinished] = useState(false);

  const matching = useMemo(() => {
    const sel = new Set(selectedIds);
    return images.filter(
      (i) =>
        i.editedUrl &&
        (scope === "approved"
          ? i.status === "APPROVED"
          : scope === "done"
            ? i.status === "DONE" || i.status === "APPROVED"
            : sel.has(i.id)),
    );
  }, [images, scope, selectedIds]);

  const params = () => {
    const p = new URLSearchParams({ scope, group, originals: String(originals), manifest: String(manifest) });
    if (scope === "selected") p.set("ids", selectedIds.join(","));
    return p;
  };

  const download = async () => {
    setFinished(false);
    try {
      const { parts } = await apiGet<{ parts: number; total: number }>(`/api/batches/${batchId}/export?${params()}`);
      for (let part = 1; part <= parts; part++) {
        setState({ part, parts, mb: 0 });
        const p = params();
        p.set("part", String(part));
        const res = await fetch(`/api/batches/${batchId}/export?${p}`);
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
          throw new Error(body?.error?.message ?? "Export failed");
        }
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          bytes += value.length;
          setState({ part, parts, mb: bytes / 1024 / 1024 });
        }
        const name =
          /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? `export_part${part}.zip`;
        const url = URL.createObjectURL(new Blob(chunks as BlobPart[], { type: "application/zip" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
      setFinished(true);
      toast.success(parts > 1 ? `Exported ${parts} ZIP parts` : "Export downloaded");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setState(null);
    }
  };

  const markComplete = async () => {
    try {
      await apiSend(`/api/batches/${batchId}`, "PATCH", { status: "COMPLETE" });
      qc.invalidateQueries({ queryKey: qk.batch(batchId) });
      toast.success("Batch marked complete");
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const preview = matching.slice(0, 4).map((i) => `${folder(i, group)}${i.outputFilename}`);

  return (
    <Dialog open={open} onOpenChange={(o) => !state && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Export</DialogTitle>
          <DialogDescription>Downloads a ZIP (split into parts of 100 images for large batches).</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="space-y-2">
            <p className="font-medium">Images</p>
            <RadioGroup value={scope} onValueChange={(v) => setScope(v as Scope)}>
              <Label className="font-normal">
                <RadioGroupItem value="approved" /> Approved only ({approvedCount})
              </Label>
              <Label className="font-normal">
                <RadioGroupItem value="done" /> All done, excluding rejected (
                {images.filter((i) => i.status === "DONE" || i.status === "APPROVED").length})
              </Label>
              <Label className="font-normal">
                <RadioGroupItem value="selected" disabled={!selectedIds.length} /> Selected ({selectedIds.length})
              </Label>
            </RadioGroup>
          </div>
          <div className="grid grid-cols-2 items-center gap-3">
            <span className="font-medium">Group into folders by</span>
            <Select value={group} onValueChange={(v) => setGroup(v as Group)}>
              <SelectTrigger aria-label="Grouping">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="flat">No folders</SelectItem>
                <SelectItem value="style">Style code</SelectItem>
                <SelectItem value="view">View angle</SelectItem>
                <SelectItem value="color">Color</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Label className="justify-between font-normal">
            Include originals <Switch checked={originals} onCheckedChange={setOriginals} />
          </Label>
          <Label className="justify-between font-normal">
            Include manifest.csv <Switch checked={manifest} onCheckedChange={setManifest} />
          </Label>
          <div className="rounded-md bg-muted p-3 font-mono text-xs">
            {preview.length ? (
              preview.map((p) => <div key={p}>{p}</div>)
            ) : (
              <span className="font-sans text-muted-foreground">No images match.</span>
            )}
            {matching.length > preview.length && (
              <div className="text-muted-foreground">…and {matching.length - preview.length} more</div>
            )}
          </div>
          {state && (
            <div className="space-y-1">
              <Progress value={((state.part - 1) / state.parts) * 100 + 100 / state.parts / 2} />
              <p className="text-xs text-muted-foreground">
                Downloading part {state.part} of {state.parts} · {state.mb.toFixed(1)} MB
              </p>
            </div>
          )}
          {finished && batchStatus !== "COMPLETE" && (
            <div className="flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 p-3">
              <span className="flex items-center gap-2 text-emerald-800">
                <CheckCircle2 className="size-4" /> Export finished
              </span>
              <Button size="sm" variant="success" onClick={markComplete}>
                Mark batch complete
              </Button>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={!!state}>
            Close
          </Button>
          <Button onClick={download} disabled={!!state || matching.length === 0} data-testid="download-export">
            {state ? <Loader2 className="animate-spin" /> : <Download />} Download {matching.length} image
            {matching.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
