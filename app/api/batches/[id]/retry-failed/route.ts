import { ok, route } from "@/lib/api";
import { retryFailed } from "@/lib/image-actions";

export const POST = route(async (_req, ctx: RouteContext<"/api/batches/[id]/retry-failed">) => {
  const { id } = await ctx.params;
  return ok({ queued: await retryFailed(id) });
});
