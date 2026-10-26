import { ok, route } from "@/lib/api";
import { reapplyStandard } from "@/lib/image-actions";
import { batchIdOf } from "@/lib/image-route";

export const POST = route(async (_req, ctx: RouteContext<"/api/images/[id]/reapply-standard">) => {
  const { id } = await ctx.params;
  return ok({ queued: await reapplyStandard(await batchIdOf(id), [id]) });
});
