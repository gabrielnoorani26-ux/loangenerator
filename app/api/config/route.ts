import { ok, route } from "@/lib/api";
import { env } from "@/lib/env";

/** Non-secret runtime config for the client (never includes keys). */
export const GET = route(async () =>
  ok({
    maxUploadMb: env.maxUploadMb,
    imageProvider: env.imageProvider,
    localMode: env.localMode,
    imageProviderConfigured: env.localMode || env.imageProvider === "mock" || Boolean(env.imageProviderApiKey),
    bgRemovalConfigured: env.localMode || Boolean(env.bgRemovalProvider && env.bgRemovalApiKey),
    qcConfigured: Boolean(env.anthropicApiKey) || env.localMode || env.imageProvider === "mock",
    aiCostPerCallCents: env.aiCostPerCallCents,
    bgRemovalCostPerCallCents: env.bgRemovalCostPerCallCents,
  }),
);
