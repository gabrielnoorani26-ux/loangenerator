import { z } from "zod";
import { ok, parseBody, route } from "@/lib/api";
import { useOriginal } from "@/lib/image-actions";
import { batchIdOf } from "@/lib/image-route";

const Body = z.object({ useOriginal: z.boolean().default(true) });

export const POST = route(async (req, ctx: RouteContext<"/api/images/[id]/use-original">) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, Body);
  return ok({ queued: await useOriginal(await batchIdOf(id), [id], body.useOriginal) });
});
