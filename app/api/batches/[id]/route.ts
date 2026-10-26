import { conflict, notFound, ok, parseBody, route } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { BatchUpdateSchema, serializeBatch } from "@/lib/batches";
import { deleteBatchFiles } from "@/lib/files";

type Ctx = RouteContext<"/api/batches/[id]">;

export const GET = route(async (_req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const batch = await prisma.batch.findUnique({
    where: { id },
    include: { images: { orderBy: { sortOrder: "asc" }, take: 4 }, preset: { select: { name: true } } },
  });
  if (!batch) throw notFound("Batch");
  return ok({ batch: serializeBatch(batch) });
});

export const PATCH = route(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, BatchUpdateSchema);
  const existing = await prisma.batch.findUnique({ where: { id } });
  if (!existing) throw notFound("Batch");
  if (body.settings && (existing.status === "PROCESSING" || existing.status === "PAUSED"))
    throw conflict("Settings can't be changed while the batch is processing");
  const batch = await prisma.batch.update({
    where: { id },
    data: {
      name: body.name,
      brand: body.brand,
      description: body.description,
      tags: body.tags ? JSON.stringify(body.tags) : undefined,
      presetId: body.presetId,
      settings: body.settings,
      status: body.status,
    },
    include: { preset: { select: { name: true } } },
  });
  if (body.name && body.name !== existing.name) await logActivity("batch.renamed", `Renamed to “${body.name}”`, id);
  if (body.status === "COMPLETE" && existing.status !== "COMPLETE") await logActivity("batch.completed", "Marked complete", id);
  return ok({ batch: serializeBatch(batch) });
});

export const DELETE = route(async (_req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const existing = await prisma.batch.findUnique({ where: { id } });
  if (!existing) throw notFound("Batch");
  await prisma.batch.delete({ where: { id } });
  await deleteBatchFiles(id);
  await logActivity("batch.deleted", `Batch “${existing.name}” deleted`);
  return ok({ ok: true });
});
