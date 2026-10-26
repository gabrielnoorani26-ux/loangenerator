"use client";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./api";
import type { BatchDTO, ImageDTO } from "@/lib/batches";
import type { PresetDTO } from "@/lib/presets";
import type { AppSettingsDTO } from "@/lib/app-settings";

export const qk = {
  batch: (id: string) => ["batch", id] as const,
  images: (id: string) => ["images", id] as const,
  batches: (params: string) => ["batches", params] as const,
  presets: ["presets"] as const,
  appSettings: ["app-settings"] as const,
  progress: (id: string) => ["progress", id] as const,
  estimate: (id: string) => ["estimate", id] as const,
};

export function useBatch(id: string, opts: { refetchInterval?: number | false } = {}) {
  return useQuery({
    queryKey: qk.batch(id),
    queryFn: async () => (await apiGet<{ batch: BatchDTO }>(`/api/batches/${id}`)).batch,
    refetchInterval: opts.refetchInterval,
  });
}

const BUSY = new Set(["QUEUED", "PROCESSING_AI", "PROCESSING_STANDARD"]);

/** Images of a batch; with `pollWhileProcessing`, refetches every 1.5 s while any image is queued/processing. */
export function useImages(id: string, opts: { pollWhileProcessing?: boolean } = {}) {
  return useQuery({
    queryKey: qk.images(id),
    queryFn: async () => (await apiGet<{ images: ImageDTO[] }>(`/api/batches/${id}/images`)).images,
    refetchInterval: opts.pollWhileProcessing
      ? (q) => (q.state.data?.some((i) => BUSY.has(i.status)) ? 1500 : false)
      : false,
  });
}

export function usePresets() {
  return useQuery({
    queryKey: qk.presets,
    queryFn: async () => (await apiGet<{ presets: PresetDTO[] }>("/api/presets")).presets,
  });
}

export function useAppSettings() {
  return useQuery({
    queryKey: qk.appSettings,
    queryFn: async () => (await apiGet<{ settings: AppSettingsDTO }>("/api/settings")).settings,
  });
}

export interface ClientConfig {
  maxUploadMb: number;
  imageProvider: string;
  imageProviderConfigured: boolean;
  bgRemovalConfigured: boolean;
  qcConfigured: boolean;
  aiCostPerCallCents: number;
  bgRemovalCostPerCallCents: number;
}

export function useConfig() {
  return useQuery({ queryKey: ["config"], queryFn: () => apiGet<ClientConfig>("/api/config"), staleTime: Infinity });
}
