"use client";
import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  { key: "upload", label: "Upload" },
  { key: "settings", label: "Settings" },
  { key: "processing", label: "Process" },
  { key: "review", label: "Review & Export" },
] as const;

export function StepIndicator({ batchId, current, reachable }: { batchId: string; current: string; reachable: Set<string> }) {
  const idx = STEPS.findIndex((s) => s.key === current);
  return (
    <ol className="flex flex-wrap items-center gap-2 text-sm">
      {STEPS.map((s, i) => {
        const done = i < idx;
        const active = i === idx;
        const canGo = reachable.has(s.key) && !active;
        const inner = (
          <span
            className={cn(
              "flex items-center gap-2 rounded-full px-3 py-1",
              active && "bg-primary text-primary-foreground",
              !active && done && "text-primary",
              !active && !done && "text-muted-foreground",
              canGo && "hover:bg-accent",
            )}
          >
            <span
              className={cn(
                "flex size-5 items-center justify-center rounded-full border text-xs",
                active && "border-white/60",
                done && "border-primary bg-primary text-white",
              )}
            >
              {done ? <Check className="size-3" /> : i + 1}
            </span>
            {s.label}
          </span>
        );
        return (
          <li key={s.key} className="flex items-center gap-2">
            {canGo ? <Link href={`/batches/${batchId}/${s.key}`}>{inner}</Link> : inner}
            {i < STEPS.length - 1 && <span className="h-px w-6 bg-border" />}
          </li>
        );
      })}
    </ol>
  );
}
