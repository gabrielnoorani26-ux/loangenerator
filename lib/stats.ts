import { prisma } from "./db";

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Dashboard + Settings usage numbers. */
export async function getStats(now = new Date()) {
  const weekAgo = new Date(now.getTime() - 7 * 86400_000);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const yearAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

  const [processedWeek, activeBatches, aiMonth, reviewed, totalImages, events, topPresets, batchCount] =
    await Promise.all([
      prisma.batchImage.count({ where: { editedKey: { not: null }, updatedAt: { gte: weekAgo } } }),
      prisma.batch.count({ where: { status: { in: ["PROCESSING", "PAUSED", "REVIEW"] } } }),
      prisma.usageEvent.count({ where: { kind: { in: ["ai_edit", "bg_removal"] }, createdAt: { gte: monthStart } } }),
      prisma.batch.aggregate({
        where: { completedCount: { gt: 0 } },
        _sum: { approvedCount: true, completedCount: true },
      }),
      prisma.batchImage.count(),
      prisma.usageEvent.findMany({ where: { createdAt: { gte: yearAgo } }, select: { kind: true, createdAt: true } }),
      prisma.preset.findMany({
        orderBy: { usageCount: "desc" },
        take: 5,
        select: { id: true, name: true, usageCount: true },
      }),
      prisma.batch.count(),
    ]);

  const months: { month: string; label: string; aiCalls: number; qcCalls: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ month: monthKey(d), label: d.toLocaleString("en-US", { month: "short" }), aiCalls: 0, qcCalls: 0 });
  }
  const byKey = new Map(months.map((m) => [m.month, m]));
  for (const e of events) {
    const m = byKey.get(monthKey(e.createdAt));
    if (!m) continue;
    if (e.kind === "qc") m.qcCalls++;
    else m.aiCalls++;
  }
  const completed = reviewed._sum.completedCount ?? 0;
  return {
    imagesProcessedThisWeek: processedWeek,
    activeBatches,
    aiCallsThisMonth: aiMonth,
    avgApprovalRate: completed ? Math.round(((reviewed._sum.approvedCount ?? 0) / completed) * 100) : null,
    totalImages,
    totalBatches: batchCount,
    aiCallsByMonth: months,
    topPresets: topPresets.filter((p) => p.usageCount > 0),
  };
}
export type Stats = Awaited<ReturnType<typeof getStats>>;
