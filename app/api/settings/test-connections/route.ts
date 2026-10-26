import { ok, route } from "@/lib/api";
import { env } from "@/lib/env";
import { getBackgroundRemovalProvider, getImageEditProvider, toProviderError } from "@/lib/providers";
import { getQcProvider } from "@/lib/qc";

interface Check {
  name: string;
  configured: boolean;
  ok: boolean;
  message: string;
}

async function check(name: string, configured: boolean, fn: () => Promise<void>): Promise<Check> {
  if (!configured) return { name, configured, ok: false, message: "Not configured" };
  try {
    await fn();
    return { name, configured, ok: true, message: "Connected" };
  } catch (err) {
    return { name, configured, ok: false, message: toProviderError(err).userMessage };
  }
}

/** Verifies each configured API key with a minimal request. */
export const POST = route(async () => {
  const results: Check[] = [];
  results.push(
    await check(
      `Image editing (${env.imageProvider}${env.imageProviderModel && env.imageProvider !== "mock" ? ` · ${env.imageProviderModel}` : ""})`,
      env.imageProvider === "mock" || !!env.imageProviderApiKey,
      () => getImageEditProvider().testConnection(),
    ),
  );
  const bg = getBackgroundRemovalProvider();
  results.push(
    await check(`Background removal (${env.bgRemovalProvider || "none"})`, !!bg, () => bg!.testConnection()),
  );
  const qc = getQcProvider();
  results.push(
    await check(`Vision QC (${qc?.name === "anthropic" ? env.anthropicQcModel : (qc?.name ?? "none")})`, !!qc, () =>
      qc!.testConnection(),
    ),
  );
  return ok({ results });
});
