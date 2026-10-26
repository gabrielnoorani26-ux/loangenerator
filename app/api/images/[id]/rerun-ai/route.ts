import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { rerunAi } from "@/lib/image-actions";
import { batchIdOf } from "@/lib/image-route";

const Body = z.object({ instruction: z.string().trim().max(500).nullable().optional() });

export const POST = route(async (req, ctx: RouteContext<"/api/images/[id]/rerun-ai">) => {
  const { id } = await ctx.params;
  const { instruction } = await parseBody(req, Body);
  return ok({ queued: await rerunAi(await batchIdOf(id), [id], instruction) });
});
