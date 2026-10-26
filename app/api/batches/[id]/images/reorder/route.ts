import { z } from "zod";
import { badRequest, notFound, ok, parseBody, route, IdList } from "@/lib/api";
import { prisma } from "@/lib/db";

const Body = z.object({ ids: IdList });

/** Body: the full ordered list of image ids. */
export const POST = route(async (req, ctx: RouteContext<"/api/batches/[id]/images/reorder">) => {
  const { id } = await ctx.params;
  const { ids } = await parseBody(req, Body);
  const existing = await prisma.batchImage.findMany({ where: { batchId: id }, select: { id: true } });
  if (existing.length === 0) throw notFound("Batch");
  const set = new Set(existing.map((e) => e.id));
  if (ids.length !== set.size || !ids.every((i) => set.has(i)))
    throw badRequest("Reorder list must contain every image exactly once");
  await prisma.$transaction(
    ids.map((imageId, idx) => prisma.batchImage.update({ where: { id: imageId }, data: { sortOrder: idx } })),
  );
  return ok({ ok: true });
});
