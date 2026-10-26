import { notFound, ok, route } from "@/lib/api";
import { getProgress } from "@/lib/progress";

export const GET = route(async (_req, ctx: RouteContext<"/api/batches/[id]/progress">) => {
  const { id } = await ctx.params;
  const progress = await getProgress(id);
  if (!progress) throw notFound("Batch");
  return ok(progress);
});
