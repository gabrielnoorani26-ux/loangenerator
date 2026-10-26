import { Badge } from "@/components/ui/badge";

type Variant = "gray" | "blue" | "slate" | "green" | "red" | "redOutline" | "amber" | "indigo" | "outline";

const BATCH: Record<string, { label: string; variant: Variant }> = {
  DRAFT: { label: "Draft", variant: "gray" },
  READY: { label: "Ready", variant: "indigo" },
  PROCESSING: { label: "Processing", variant: "blue" },
  PAUSED: { label: "Paused", variant: "amber" },
  REVIEW: { label: "Review", variant: "amber" },
  COMPLETE: { label: "Complete", variant: "green" },
  CANCELLED: { label: "Cancelled", variant: "red" },
};

const IMAGE: Record<string, { label: string; variant: Variant }> = {
  QUEUED: { label: "Queued", variant: "gray" },
  PROCESSING_AI: { label: "AI editing", variant: "blue" },
  PROCESSING_STANDARD: { label: "Finishing", variant: "blue" },
  DONE: { label: "Done", variant: "slate" },
  FAILED: { label: "Failed", variant: "redOutline" },
  APPROVED: { label: "Approved", variant: "green" },
  REJECTED: { label: "Rejected", variant: "red" },
};

export function BatchStatusBadge({ status }: { status: string }) {
  const s = BATCH[status] ?? { label: status, variant: "gray" as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export function ImageStatusBadge({ status, needsReview }: { status: string; needsReview?: boolean }) {
  if (needsReview) return <Badge variant="amber">Needs review</Badge>;
  const s = IMAGE[status] ?? { label: status, variant: "gray" as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

export function QcBadge({ score }: { score: number | null | undefined }) {
  if (score == null) return null;
  const variant = score >= 85 ? "green" : score >= 70 ? "amber" : "red";
  return (
    <Badge variant={variant} title="Automated QC score">
      QC {score}
    </Badge>
  );
}
