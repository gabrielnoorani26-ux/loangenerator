import { prisma } from "./db";

export async function logActivity(action: string, details?: string | null, batchId?: string | null) {
  try {
    await prisma.activityLog.create({ data: { action, details: details ?? null, batchId: batchId ?? null } });
  } catch (err) {
    // Activity logging must never break the main operation.
    console.error("[activity] failed to log", err);
  }
}
