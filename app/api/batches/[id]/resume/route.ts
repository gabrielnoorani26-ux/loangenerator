import { ok, route } from "@/lib/api";
import { resumeBatch } from "@/lib/queue";

export const POST = route(async (_req, ctx: RouteContext<"/api/batches/[id]/resume">) => {
  const { id } = await ctx.params;
  await resumeBatch(id);
  return ok({ ok: true });
});
