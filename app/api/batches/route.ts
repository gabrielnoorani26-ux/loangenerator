import { z } from "zod";
import { ok, parseBody, parseQuery, route } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { prisma, type Prisma } from "@/lib/db";
import { BATCH_STATUSES, BatchCreateSchema, defaultBatchName, initialSettingsFor, serializeBatch } from "@/lib/batches";
import { getAppSettings } from "@/lib/app-settings";
import { parseJsonArray } from "@/lib/json";

const ListQuery = z.object({
  status: z.enum(BATCH_STATUSES).optional(),
  brand: z.string().max(80).optional(),
  search: z.string().max(120).optional(),
  sort: z.enum(["newest", "oldest", "name", "images"]).default("newest"),
});

export const GET = route(async (req) => {
  const q = parseQuery(req, ListQuery);
  const where: Prisma.BatchWhereInput = {};
  if (q.status) where.status = q.status;
  if (q.brand) where.brand = q.brand;
  if (q.search) where.OR = [{ name: { contains: q.search } }, { description: { contains: q.search } }, { tags: { contains: q.search } }];
  const orderBy: Prisma.BatchOrderByWithRelationInput =
    q.sort === "oldest" ? { createdAt: "asc" } : q.sort === "name" ? { name: "asc" } : q.sort === "images" ? { totalImages: "desc" } : { createdAt: "desc" };
  const batches = await prisma.batch.findMany({
    where,
    orderBy,
    take: 500,
    include: { images: { orderBy: { sortOrder: "asc" }, take: 4 }, preset: { select: { name: true } } },
  });
  return ok({ batches: batches.map(serializeBatch) });
});

export const POST = route(async (req) => {
  const body = await parseBody(req, BatchCreateSchema);
  const app = await getAppSettings();
  const { settings, presetId } = await initialSettingsFor(body.presetId);
  const brand = body.brand ?? parseJsonArray<string>(app.brandList)[0] ?? "Other";
  const batch = await prisma.batch.create({
    data: {
      name: body.name ?? defaultBatchName(),
      brand,
      description: body.description ?? null,
      tags: JSON.stringify(body.tags ?? []),
      presetId,
      settings,
    },
  });
  await logActivity("batch.created", `Batch “${batch.name}” created`, batch.id);
  return ok({ batch: serializeBatch(batch) }, { status: 201 });
});
