"use client";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/client/api";
import type { PresetDTO } from "@/lib/presets";

export default function PresetsPage() {
  const { data } = useQuery({ queryKey: ["presets"], queryFn: () => apiGet<{ presets: PresetDTO[] }>("/api/presets") });
  return (
    <div className="space-y-2 p-8">
      {data?.presets.map((p) => (
        <div key={p.id} data-testid="preset">{p.name} — {p.summary}</div>
      ))}
    </div>
  );
}
