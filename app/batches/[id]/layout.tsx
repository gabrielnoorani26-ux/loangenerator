"use client";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useBatch } from "@/lib/client/hooks";
import { StepIndicator } from "@/components/step-indicator";
import { BatchStatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export default function BatchLayout({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const pathname = usePathname();
  const step = pathname.split("/")[3] ?? "upload";
  const { data: batch, error } = useBatch(id);

  const reachable = new Set<string>();
  if (batch) {
    const s = batch.status;
    if (s === "DRAFT" || s === "READY" || s === "REVIEW") reachable.add("upload");
    if (batch.totalImages > 0 && s !== "PROCESSING" && s !== "PAUSED") reachable.add("settings");
    if (batch.hasSnapshot) reachable.add("processing");
    if (["REVIEW", "COMPLETE", "CANCELLED", "PROCESSING", "PAUSED"].includes(s) && batch.hasSnapshot) reachable.add("review");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <div className="border-b bg-card px-6 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/" className="text-muted-foreground hover:text-foreground" aria-label="Back to dashboard">
              <ArrowLeft className="size-4" />
            </Link>
            {batch ? (
              <>
                <h1 className="truncate text-lg font-semibold" data-testid="batch-name">{batch.name}</h1>
                <Badge variant="outline">{batch.brand}</Badge>
                <BatchStatusBadge status={batch.status} />
              </>
            ) : error ? (
              <span className="text-sm text-destructive">Batch not found</span>
            ) : (
              <Skeleton className="h-6 w-56" />
            )}
          </div>
          <StepIndicator batchId={id} current={step} reachable={reachable} />
        </div>
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}
