import { z } from "zod";
import { ok, parseQuery, route } from "@/lib/api";
import { prisma, type Prisma } from "@/lib/db";

const Query = z.object({
  batchId: z.string().max(64).optional(),
  action: z.string().max(64).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(200).default(50),
});

export const GET = route(async (req) => {
  const q = parseQuery(req, Query);
  const where: Prisma.ActivityLogWhereInput = {};
  if (q.batchId) where.batchId = q.batchId;
  if (q.action) where.action = { startsWith: q.action };
  if (q.from || q.to) {
    where.createdAt = {};
    if (q.from) where.createdAt.gte = new Date(`${q.from}T00:00:00`);
    if (q.to) where.createdAt.lte = new Date(`${q.to}T23:59:59.999`);
  }
  const [total, rows] = await Promise.all([
    prisma.activityLog.count({ where }),
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: { batch: { select: { id: true, name: true } } },
    }),
  ]);
  return ok({
    total,
    page: q.page,
    pageSize: q.pageSize,
    pages: Math.max(1, Math.ceil(total / q.pageSize)),
    rows: rows.map((r) => ({ id: r.id, action: r.action, details: r.details, createdAt: r.createdAt, batch: r.batch })),
  });
});
