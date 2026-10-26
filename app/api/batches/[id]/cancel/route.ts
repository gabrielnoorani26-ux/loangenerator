import { ok, route } from "@/lib/api";
import { cancelBatch } from "@/lib/queue";

export const POST = route(async (_req, ctx: RouteContext<"/api/batches/[id]/cancel">) => {
  const { id } = await ctx.params;
  await cancelBatch(id);
  return ok({ ok: true });
});
