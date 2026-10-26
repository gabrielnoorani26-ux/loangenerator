import { z } from "zod";
import { IdParam, ok, parseBody, route } from "@/lib/api";
import { revertToVersion } from "@/lib/image-actions";
import { serializeImage } from "@/lib/batches";

const Body = z.object({ versionId: IdParam });

export const POST = route(async (req, ctx: RouteContext<"/api/images/[id]/revert">) => {
  const { id } = await ctx.params;
  const { versionId } = await parseBody(req, Body);
  return ok({ image: serializeImage(await revertToVersion(id, versionId)) });
});
