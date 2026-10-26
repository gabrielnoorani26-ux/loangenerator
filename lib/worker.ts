/**
 * In-process queue worker. Run it with `npm run worker` (separate process) or
 * inside the Next.js server via instrumentation.ts (RUN_WORKER_IN_APP=true).
 * Run only ONE worker per database: the concurrency limit is per process.
 */
import { prisma } from "./db";
import { getAppSettings } from "./app-settings";
import { processImage, type PipelineImage } from "./pipeline";
import { getBackgroundRemovalProvider, getImageEditProvider } from "./providers";
import { getQcProvider } from "./qc";
import {
  claimJobs,
  completeJob,
  failJob,
  heartbeat,
  recordAiResult,
  recoverStuck,
  setPhase,
  type ClaimedJob,
} from "./queue";
import { parseEditSettings } from "./settings";
import { storage } from "./storage";

const TICK_MS = 1_000;
const RECOVER_EVERY_MS = 60_000;
const HEARTBEAT_MS = 30_000;
const RATE_LIMIT_PENALTY_MS = 60_000;

export class Worker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private ticking = false;
  private active = new Map<string, Promise<void>>();
  private lastRecover = 0;
  /** No claims before this time (global Retry-After). */
  private pausedUntil = 0;
  /** Concurrency is halved until this time after a 429. */
  private penaltyUntil = 0;
  /** Serializes output-filename assignment per batch so names stay unique. */
  private nameLocks = new Map<string, Promise<unknown>>();

  constructor(private readonly log: (msg: string) => void = (m) => console.log(`[worker] ${m}`)) {}

  async start() {
    if (this.running) return;
    this.running = true;
    await recoverStuck(new Date());
    this.lastRecover = Date.now();
    this.log("started");
    this.schedule();
  }

  /** Stop claiming; wait for in-flight jobs (up to timeoutMs). */
  async stop(timeoutMs = 30_000) {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    const all = Promise.allSettled([...this.active.values()]);
    await Promise.race([all, new Promise((r) => setTimeout(r, timeoutMs))]);
    this.log("stopped");
  }

  get activeCount() {
    return this.active.size;
  }

  private schedule() {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.tick()
        .catch((e) => this.log(`tick error: ${e instanceof Error ? e.message : e}`))
        .finally(() => this.schedule());
    }, TICK_MS);
  }

  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = Date.now();
      if (now - this.lastRecover > RECOVER_EVERY_MS) {
        this.lastRecover = now;
        await recoverStuck(new Date(), new Set(this.active.keys()));
      }
      if (now < this.pausedUntil) return;
      const app = await getAppSettings();
      let limit = Math.max(1, Math.min(5, app.maxConcurrentAiCalls));
      if (now < this.penaltyUntil) limit = Math.max(1, Math.floor(limit / 2));
      const free = limit - this.active.size;
      if (free <= 0) return;
      const jobs = await claimJobs(free);
      for (const job of jobs) {
        const p = this.run(job, app.maxRetries, app.autoQcEnabled, app.qcThreshold).finally(() => this.active.delete(job.image.id));
        this.active.set(job.image.id, p);
      }
    } finally {
      this.ticking = false;
    }
  }

  /** For tests: tick until no work remains (or timeout). */
  async drain(timeoutMs = 60_000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      await this.tick();
      if (this.active.size) await Promise.race([...this.active.values()]);
      const remaining = await prisma.batchImage.count({ where: { status: { in: ["QUEUED", "PROCESSING_AI", "PROCESSING_STANDARD"] }, batch: { status: { in: ["PROCESSING", "REVIEW", "COMPLETE"] } } } });
      if (remaining === 0 && this.active.size === 0) return;
      if (!this.active.size) await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("drain timed out");
  }

  private async run(job: ClaimedJob, maxRetries: number, autoQc: boolean, qcThreshold: number) {
    const hb = setInterval(() => void heartbeat(job).catch(() => undefined), HEARTBEAT_MS);
    const img = job.image;
    try {
      const batch = await prisma.batch.findUnique({ where: { id: img.batchId } });
      if (!batch) return;
      const settings = parseEditSettings(batch.settingsSnapshot ?? batch.settings);
      const index = (await prisma.batchImage.count({ where: { batchId: img.batchId, sortOrder: { lt: img.sortOrder } } })) + 1;
      const pImage: PipelineImage = {
        id: img.id,
        batchId: img.batchId,
        originalKey: img.originalKey,
        originalFilename: img.originalFilename,
        aiIntermediateKey: img.aiIntermediateKey,
        aiSettingsHash: img.aiSettingsHash,
        perImageInstruction: img.perImageInstruction,
        useOriginal: img.useOriginal,
        styleCode: img.styleCode,
        colorName: img.colorName,
        viewAngle: img.viewAngle,
        qcScore: img.qcScore,
        index,
      };
      // Filenames are assigned under a per-batch lock so concurrent jobs can't collide.
      const result = await processImage(
        pImage,
        {
          settings,
          batchName: batch.name,
          brand: batch.brand,
          jobKind: img.jobKind === "STANDARD" ? "STANDARD" : "FULL",
          takenNames: new Set(), // filled below under the lock
          autoQc,
          qcThreshold,
          now: new Date(),
        },
        {
          storage: storage(),
          editProvider: getImageEditProvider,
          bgProvider: getBackgroundRemovalProvider,
          qcProvider: getQcProvider,
          onPhase: (phase) => setPhase(job, phase),
          onAiResult: (r) => recordAiResult(job, r),
        },
      );
      await this.withNameLock(img.batchId, async () => {
        const others = await prisma.batchImage.findMany({
          where: { batchId: img.batchId, id: { not: img.id }, outputFilename: { not: null } },
          select: { outputFilename: true },
        });
        const taken = new Set(others.map((o) => o.outputFilename!.toLowerCase()));
        result.outputFilename = dedupe(result.outputFilename, taken);
        const saved = await completeJob(job, result);
        if (!saved) this.log(`lost lock on ${img.id}; result discarded`);
      });
    } catch (err) {
      const outcome = await failJob(job, err, maxRetries);
      if (outcome.error.kind === "rate_limit") {
        const wait = outcome.error.retryAfterMs ?? 5_000;
        this.pausedUntil = Math.max(this.pausedUntil, Date.now() + wait);
        this.penaltyUntil = Date.now() + RATE_LIMIT_PENALTY_MS;
        this.log(`rate limited — pausing claims ${Math.round(wait / 1000)}s and halving concurrency`);
      }
      this.log(`${img.originalFilename}: ${outcome.error.kind}${outcome.retried ? ` (retry in ${outcome.delayMs / 1000}s)` : " (failed)"}`);
    } finally {
      clearInterval(hb);
    }
  }

  private async withNameLock<T>(batchId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.nameLocks.get(batchId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.nameLocks.set(batchId, next.catch(() => undefined));
    return next;
  }
}

/** Re-apply _2, _3… if another image took this name meanwhile. */
export function dedupe(filename: string, taken: Set<string>): string {
  if (!taken.has(filename.toLowerCase())) return filename;
  const m = filename.match(/^(.*?)(?:_(\d+))?\.([A-Za-z0-9]+)$/);
  const base = m ? m[1] : filename;
  const ext = m ? m[3] : "";
  let n = 2;
  let name = `${base}_${n}.${ext}`;
  while (taken.has(name.toLowerCase())) name = `${base}_${++n}.${ext}`;
  return name;
}

let singleton: Worker | null = null;
export function getWorker(): Worker {
  if (!singleton) singleton = new Worker();
  return singleton;
}
