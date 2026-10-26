import { ok, route } from "@/lib/api";
import { pauseBatch } from "@/lib/queue";

export const POST = route(async (_req, ctx: RouteContext<"/api/batches/[id]/pause">) => {
  const { id } = await ctx.params;
  await pauseBatch(id);
  return ok({ ok: true });
});
