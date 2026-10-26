/**
 * Standalone queue worker: `npm run worker`.
 * Survives restarts: on start it resets images stuck in PROCESSING_* back to QUEUED.
 */
import "dotenv/config";
import { Worker } from "../lib/worker";
import { prisma } from "../lib/db";

const worker = new Worker();
let stopping = false;

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[worker] ${signal} received — finishing in-flight images…`);
  await worker.stop(30_000);
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

worker.start().catch((e) => {
  console.error("[worker] failed to start", e);
  process.exit(1);
});
