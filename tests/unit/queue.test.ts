import { afterEach, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { setProviders } from "@/lib/providers";
import { ProviderError, type ImageEditProvider, type ImageEditRequest } from "@/lib/providers/types";
import { MockImageEditProvider } from "@/lib/providers/mock";
import { claimJobs, cancelBatch, pauseBatch, recoverStuck, requeueImages, resumeBatch, startBatch } from "@/lib/queue";
import { Worker, dedupe } from "@/lib/worker";
import { setQcProvider } from "@/lib/qc";
import { storage } from "@/lib/storage";
import { AI_SETTINGS, makeBatch } from "./helpers";

class ScriptedProvider implements ImageEditProvider {
  readonly name = "scripted";
  calls = 0;
  prompts: string[] = [];
  constructor(private readonly script: (call: number, req: ImageEditRequest) => Error | null = () => null) {}
  async edit(req: ImageEditRequest) {
    this.calls++;
    this.prompts.push(req.prompt);
    const err = this.script(this.calls, req);
    if (err) throw err;
    return sharp(req.image).tint({ r: 255, g: 200, b: 200 }).png().toBuffer();
  }
  async testConnection() {}
}

const quietWorker = () => new Worker(() => undefined);

beforeEach(async () => {
  await prisma.imageVersion.deleteMany();
  await prisma.batchImage.deleteMany();
  await prisma.batch.deleteMany();
  await prisma.appSettings.deleteMany();
  await prisma.usageEvent.deleteMany();
  setQcProvider(null);
});
afterEach(() => setProviders(null));

describe("queue + worker", () => {
  it("processes a batch end-to-end with one AI call per image and unique filenames", async () => {
    const provider = new ScriptedProvider();
    setProviders(provider, null);
    const batch = await makeBatch(6, AI_SETTINGS);
    await startBatch(batch.id);
    await quietWorker().drain();

    const b = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } });
    const imgs = await prisma.batchImage.findMany({ where: { batchId: batch.id } });
    expect(b.status).toBe("REVIEW");
    expect(b.completedCount).toBe(6);
    expect(b.aiCallsUsed).toBe(6);
    expect(provider.calls).toBe(6);
    expect(provider.prompts[0]).toContain("Preserve the product exactly as it appears");
    expect(imgs.every((i) => i.status === "DONE" && i.editedKey && i.aiIntermediateKey)).toBe(true);
    const names = imgs.map((i) => i.outputFilename);
    expect(new Set(names).size).toBe(6);
    expect(names).toContain("black_side.jpg");
    expect(names).toContain("black_side_2.jpg");
    for (const i of imgs) expect(await storage().exists(i.editedKey!)).toBe(true);
    // originals untouched
    const meta = await sharp(await storage().get(imgs[0].originalKey)).metadata();
    expect(meta.format).toBe("png");
    expect(await prisma.usageEvent.count({ where: { kind: "ai_edit" } })).toBe(6);
  });

  it("re-applying standard edits costs zero AI calls and keeps the previous version", async () => {
    const provider = new ScriptedProvider();
    setProviders(provider, null);
    const batch = await makeBatch(2, AI_SETTINGS);
    await startBatch(batch.id);
    const w = quietWorker();
    await w.drain();
    const ids = (await prisma.batchImage.findMany({ where: { batchId: batch.id } })).map((i) => i.id);
    await requeueImages(batch.id, ids, { kind: "STANDARD" });
    await w.drain();
    expect(provider.calls).toBe(2);
    expect((await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } })).aiCallsUsed).toBe(2);
    expect(await prisma.imageVersion.count({ where: { imageId: { in: ids } } })).toBe(2);
  });

  it("restarting a batch with unchanged AI settings reuses cached AI results", async () => {
    const provider = new ScriptedProvider();
    setProviders(provider, null);
    const batch = await makeBatch(3, AI_SETTINGS);
    await startBatch(batch.id);
    const w = quietWorker();
    await w.drain();
    // change only standard settings, then start again
    await prisma.batch.update({
      where: { id: batch.id },
      data: {
        settings: {
          ...((await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } })).settings as object),
          output: {
            format: "png",
            quality: 90,
            maxKb: null,
            stripMetadata: true,
            namingPattern: "{original}",
            flattenColor: "#FFFFFF",
          },
        },
      },
    });
    const est = await startBatch(batch.id);
    expect(est.cacheHits).toBe(3);
    expect(est.aiCalls).toBe(0);
    await w.drain();
    expect(provider.calls).toBe(3);
  });

  it("retries retryable errors with backoff and then succeeds", async () => {
    const provider = new ScriptedProvider((n) => (n === 1 ? new ProviderError("server", "boom") : null));
    setProviders(provider, null);
    const batch = await makeBatch(1, AI_SETTINGS);
    await startBatch(batch.id);
    await quietWorker().drain();
    const img = await prisma.batchImage.findFirstOrThrow({ where: { batchId: batch.id } });
    expect(img.status).toBe("DONE");
    expect(img.retryCount).toBe(1);
    expect(provider.calls).toBe(2);
  });

  it("fails after maxRetries with a human-readable message, without stopping the batch", async () => {
    const provider = new ScriptedProvider((_n, req) =>
      req.prompt.includes("ALWAYS-FAIL") ? new ProviderError("timeout") : null,
    );
    setProviders(provider, null);
    await prisma.appSettings.create({ data: { id: "singleton", maxRetries: 2, maxConcurrentAiCalls: 1 } });
    const batch = await makeBatch(2, AI_SETTINGS);
    const first = await prisma.batchImage.findFirstOrThrow({ where: { batchId: batch.id, sortOrder: 0 } });
    await prisma.batchImage.update({ where: { id: first.id }, data: { perImageInstruction: "ALWAYS-FAIL" } });
    await startBatch(batch.id);
    await quietWorker().drain(90_000);
    const imgs = await prisma.batchImage.findMany({ where: { batchId: batch.id }, orderBy: { sortOrder: "asc" } });
    expect(imgs[0].status).toBe("FAILED");
    expect(imgs[0].errorMessage).toBe("The AI provider took too long to respond.");
    expect(imgs[0].retryCount).toBe(3);
    expect(imgs[1].status).toBe("DONE");
    const b = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(b.status).toBe("REVIEW");
    expect(b.failedCount).toBe(1);
  }, 120_000);

  it("does not retry non-retryable errors such as content policy", async () => {
    setProviders(new ScriptedProvider(() => new ProviderError("content_policy", "flagged")), null);
    const batch = await makeBatch(1, AI_SETTINGS);
    await startBatch(batch.id);
    await quietWorker().drain();
    const img = await prisma.batchImage.findFirstOrThrow({ where: { batchId: batch.id } });
    expect(img.status).toBe("FAILED");
    expect(img.retryCount).toBe(1);
    expect(img.errorMessage).toMatch(/content policy/);
  });

  it("never claims the same image twice, even with concurrent claimers", async () => {
    const batch = await makeBatch(5, AI_SETTINGS);
    await startBatch(batch.id);
    const [a, b, c] = await Promise.all([claimJobs(5), claimJobs(5), claimJobs(5)]);
    const ids = [...a, ...b, ...c].map((j) => j.image.id);
    expect(ids.length).toBe(5);
    expect(new Set(ids).size).toBe(5);
    const counts = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(counts.totalImages).toBe(5);
  });

  it("claims oldest batch first", async () => {
    const older = await makeBatch(2, AI_SETTINGS, "older");
    await startBatch(older.id);
    await new Promise((r) => setTimeout(r, 20));
    const newer = await makeBatch(2, AI_SETTINGS, "newer");
    await startBatch(newer.id);
    const jobs = await claimJobs(2);
    expect(jobs.every((j) => j.image.batchId === older.id)).toBe(true);
  });

  it("recovers images stuck in processing for more than 3 minutes", async () => {
    const batch = await makeBatch(2, AI_SETTINGS);
    await startBatch(batch.id);
    const [job] = await claimJobs(1);
    await prisma.batchImage.update({
      where: { id: job.image.id },
      data: { lockedAt: new Date(Date.now() - 4 * 60_000) },
    });
    const [fresh] = await claimJobs(1);
    expect(await recoverStuck()).toBe(1);
    expect((await prisma.batchImage.findUniqueOrThrow({ where: { id: job.image.id } })).status).toBe("QUEUED");
    expect((await prisma.batchImage.findUniqueOrThrow({ where: { id: fresh.image.id } })).status).toBe("PROCESSING_AI");
  });

  it("pause stops claiming; resume continues; cancel skips the rest", async () => {
    setProviders(new MockImageEditProvider(), null);
    const batch = await makeBatch(3, AI_SETTINGS);
    await startBatch(batch.id);
    await pauseBatch(batch.id);
    expect(await claimJobs(5)).toHaveLength(0);
    await resumeBatch(batch.id);
    const jobs = await claimJobs(1);
    expect(jobs).toHaveLength(1);
    await cancelBatch(batch.id);
    expect(await claimJobs(5)).toHaveLength(0);
    const b = await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(b.status).toBe("CANCELLED");
    expect(await prisma.batchImage.count({ where: { batchId: batch.id, status: "QUEUED" } })).toBe(2);
  });

  it("skips AI for use-original images and charges nothing for standard-only settings", async () => {
    const provider = new ScriptedProvider();
    setProviders(provider, null);
    const batch = await makeBatch(2, AI_SETTINGS);
    const first = await prisma.batchImage.findFirstOrThrow({ where: { batchId: batch.id } });
    await prisma.batchImage.update({ where: { id: first.id }, data: { useOriginal: true } });
    await startBatch(batch.id);
    await quietWorker().drain();
    expect(provider.calls).toBe(1);

    const noAi = await makeBatch(2, { standard: { resize: { enabled: true, mode: "longest", value: 100 } } });
    await startBatch(noAi.id);
    await quietWorker().drain();
    expect(provider.calls).toBe(1);
    expect((await prisma.batch.findUniqueOrThrow({ where: { id: noAi.id } })).aiCallsUsed).toBe(0);
  });

  it("an AI result is cached even if a later step fails, so the retry doesn't pay again", async () => {
    const provider = new ScriptedProvider();
    setProviders(provider, null);
    // An invalid watermark-free setting can't fail; instead make the original unreadable after the AI step.
    const batch = await makeBatch(1, AI_SETTINGS);
    await startBatch(batch.id);
    const img = await prisma.batchImage.findFirstOrThrow({ where: { batchId: batch.id } });
    const realGet = storage().get.bind(storage());
    let getCalls = 0;
    const store = storage() as unknown as { get: (k: string) => Promise<Buffer> };
    store.get = async (k: string) => {
      if (k === img.originalKey && ++getCalls === 2) throw new Error("disk hiccup"); // 2nd read = standard step
      return realGet(k);
    };
    try {
      await quietWorker().drain();
    } finally {
      store.get = realGet;
    }
    const after = await prisma.batchImage.findUniqueOrThrow({ where: { id: img.id } });
    expect(after.status).toBe("DONE");
    expect(after.retryCount).toBe(1);
    expect(provider.calls).toBe(1);
    expect((await prisma.batch.findUniqueOrThrow({ where: { id: batch.id } })).aiCallsUsed).toBe(1);
  });
});

describe("dedupe", () => {
  it("appends _2/_3 when a name is taken", () => {
    expect(dedupe("a.jpg", new Set())).toBe("a.jpg");
    expect(dedupe("a.jpg", new Set(["a.jpg"]))).toBe("a_2.jpg");
    expect(dedupe("a.jpg", new Set(["a.jpg", "a_2.jpg"]))).toBe("a_3.jpg");
  });
});
