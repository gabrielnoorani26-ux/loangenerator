import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { AnthropicQcProvider, MockQcProvider, parseQcResponse, QC_INSTRUCTION, QC_UNAVAILABLE, runQc, toQcJpeg, type QcProvider } from "@/lib/qc";
import { productPng } from "./helpers";

const fake = (replies: (string | Error)[]): QcProvider & { calls: number } => ({
  name: "fake",
  calls: 0,
  async compare() {
    const r = replies[this.calls++];
    if (r instanceof Error) throw r;
    return r;
  },
  async testConnection() {},
});

describe("parseQcResponse", () => {
  it("accepts strict JSON and JSON wrapped in prose/code fences", () => {
    expect(parseQcResponse('{"score": 92, "issues": [], "verdict": "pass"}')).toEqual({ score: 92, issues: [], verdict: "pass" });
    expect(parseQcResponse('```json\n{"score": 61.6, "issues": ["halo"], "verdict": "review"}\n```')).toEqual({ score: 62, issues: ["halo"], verdict: "review" });
  });
  it("rejects invalid shapes", () => {
    expect(parseQcResponse("looks fine")).toBeNull();
    expect(parseQcResponse('{"score": 150, "issues": [], "verdict": "pass"}')).toBeNull();
    expect(parseQcResponse('{"score": 80, "verdict": "maybe"}')).toBeNull();
  });
});

describe("runQc", () => {
  it("retries once on unparseable output, then succeeds", async () => {
    const p = fake(["nope", '{"score": 88, "issues": [], "verdict": "pass"}']);
    expect(await runQc(p, await productPng(), await productPng(), 70)).toEqual({ score: 88, issues: [], verdict: "pass" });
    expect(p.calls).toBe(2);
  });
  it("falls back to review after two failures and never throws", async () => {
    const p = fake([new Error("500"), "garbage"]);
    expect(await runQc(p, await productPng(), await productPng(), 70)).toEqual(QC_UNAVAILABLE);
    expect(QC_UNAVAILABLE.issues).toEqual(["QC could not be completed"]);
  });
  it("forces review below the threshold even if the model says pass", async () => {
    const p = fake(['{"score": 65, "issues": ["logo blurred"], "verdict": "pass"}']);
    expect((await runQc(p, await productPng(), await productPng(), 70)).verdict).toBe("review");
  });
  it("handles unreadable images gracefully", async () => {
    expect(await runQc(fake([]), Buffer.from("x"), Buffer.from("y"), 70)).toEqual(QC_UNAVAILABLE);
  });
});

describe("QC images", () => {
  it("downscales to ≤1024px JPEG", async () => {
    const big = await sharp({ create: { width: 3000, height: 2000, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const meta = await sharp(await toQcJpeg(big)).metadata();
    expect(meta.format).toBe("jpeg");
    expect(Math.max(meta.width!, meta.height!)).toBe(1024);
  });
});

describe("AnthropicQcProvider request", () => {
  it("sends both images + the spec instruction to the Messages API", async () => {
    let captured: { url: string; body: Record<string, unknown>; headers: Headers } | null = null;
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) };
      return new Response(
        JSON.stringify({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-opus-5-5",
          content: [{ type: "text", text: '{"score": 95, "issues": [], "verdict": "pass"}' }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const p = new AnthropicQcProvider("sk-test", "claude-opus-5-5", fetchImpl);
    const r = await runQc(p, await productPng(), await productPng("#00aa00"), 70);
    expect(r).toEqual({ score: 95, issues: [], verdict: "pass" });
    const c = captured!;
    expect(c.url).toContain("/v1/messages");
    expect(c.body.model).toBe("claude-opus-5-5");
    const content = (c.body.messages as { content: { type: string; text?: string; source?: { media_type: string } }[] }[])[0].content;
    expect(content.filter((b) => b.type === "image")).toHaveLength(2);
    expect(content.find((b) => b.type === "image")!.source!.media_type).toBe("image/jpeg");
    expect(content.at(-1)!.text).toBe(QC_INSTRUCTION);
    // SDK v1 sends the key as x-api-key or a Bearer token depending on version
    expect(c.headers.get("x-api-key") ?? c.headers.get("authorization")).toContain("sk-test");
  });
});

describe("mock QC on a good vs. deliberately altered pair", () => {
  it("scores the faithful edit high and the altered product low", async () => {
    const original = await productPng("#aa3322");
    const good = await sharp(original).modulate({ brightness: 1.03 }).png().toBuffer();
    const altered = await productPng("#2244cc", 300, 200); // product recolored
    const qc = new MockQcProvider();
    const goodR = await runQc(qc, original, good, 70);
    const badR = await runQc(qc, original, altered, 70);
    expect(goodR.verdict).toBe("pass");
    expect(goodR.score).toBeGreaterThanOrEqual(85);
    expect(badR.score).toBeLessThan(goodR.score);
  });
});
