import { ok, route } from "@/lib/api";
import { setReviewStatus } from "@/lib/image-actions";
import { batchIdOf } from "@/lib/image-route";

export const POST = route(async (_req, ctx: RouteContext<"/api/images/[id]/reject">) => {
  const { id } = await ctx.params;
  return ok({ updated: await setReviewStatus(await batchIdOf(id), [id], "REJECTED") });
});
