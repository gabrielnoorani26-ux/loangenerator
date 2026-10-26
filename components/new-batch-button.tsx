"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { apiSend, errorMessage } from "@/lib/client/api";

export function NewBatchButton({ size = "default", label = "New batch" }: { size?: "default" | "lg"; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const r = await apiSend<{ batch: { id: string } }>("/api/batches", "POST", {});
      router.push(`/batches/${r.batch.id}/upload`);
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <Button size={size} onClick={create} disabled={busy} data-testid="new-batch">
      {busy ? <Loader2 className="animate-spin" /> : <Plus />} {label}
    </Button>
  );
}
