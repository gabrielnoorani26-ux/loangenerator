/**
 * Optionally runs the queue worker inside the Next.js server process.
 * Default is a separate process (`npm run worker`); set RUN_WORKER_IN_APP=true
 * to use this instead. Never run both against the same database.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.RUN_WORKER_IN_APP !== "true") return;
  const { getWorker } = await import("./lib/worker");
  await getWorker().start();
}
