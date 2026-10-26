import { ok, route } from "@/lib/api";
import { env } from "@/lib/env";

/** Non-secret runtime config for the client (never includes keys). */
export const GET = route(async () =>
  ok({
    maxUploadMb: env.maxUploadMb,
    imageProvider: env.imageProvider,
    imageProviderConfigured: env.imageProvider === "mock" || Boolean(env.imageProviderApiKey),
    bgRemovalConfigured: Boolean(env.bgRemovalProvider && env.bgRemovalApiKey),
    qcConfigured: Boolean(env.anthropicApiKey) || env.imageProvider === "mock",
    aiCostPerCallCents: env.aiCostPerCallCents,
    bgRemovalCostPerCallCents: env.bgRemovalCostPerCallCents,
  }),
);
