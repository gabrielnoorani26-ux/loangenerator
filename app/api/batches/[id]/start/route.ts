import { ok, route } from "@/lib/api";
import { startBatch } from "@/lib/queue";

export const POST = route(async (_req, ctx: RouteContext<"/api/batches/[id]/start">) => {
  const { id } = await ctx.params;
  const estimate = await startBatch(id);
  return ok({ ok: true, estimate });
});
