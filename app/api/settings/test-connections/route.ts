import { ok, route } from "@/lib/api";
import { env } from "@/lib/env";
import { modelDownloaded, modelSpec } from "@/lib/local/models";
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

/** Verifies each configured API key with a minimal request (local mode: loads the model, downloading it once). */
export const POST = route(async () => {
  const results: Check[] = [];
  if (env.localMode) {
    const spec = modelSpec();
    const wasDownloaded = modelDownloaded(spec);
    const res = await check(`Local edits (${spec.file})`, true, () => getImageEditProvider().testConnection());
    if (res.ok) res.message = wasDownloaded ? "Model loaded — runs offline" : "Model downloaded and loaded";
    results.push(res);
  } else {
    results.push(
      await check(
        `Image editing (${env.imageProvider}${env.imageProviderModel && env.imageProvider !== "mock" ? ` · ${env.imageProviderModel}` : ""})`,
        env.imageProvider === "mock" || !!env.imageProviderApiKey,
        () => getImageEditProvider().testConnection(),
      ),
    );
  }
  const bg = getBackgroundRemovalProvider();
  results.push(await check(`Background removal (${bg?.name ?? "none"})`, !!bg, () => bg!.testConnection()));
  const qc = getQcProvider();
  results.push(
    await check(`Vision QC (${qc?.name === "anthropic" ? env.anthropicQcModel : (qc?.name ?? "none")})`, !!qc, () =>
      qc!.testConnection(),
    ),
  );
  return ok({ results });
});
