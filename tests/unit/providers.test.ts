import { describe, expect, it } from "vitest";
import { chooseSize } from "@/lib/providers/openai";
import { errorFromStatus, parseRetryAfter, ProviderError, toProviderError } from "@/lib/providers/types";
import { MockImageEditProvider } from "@/lib/providers/mock";
import { productPng } from "./helpers";

describe("chooseSize (OpenAI)", () => {
  it("matches aspect ratio with multiples of 16 for gpt-image-2+", () => {
    const s = chooseSize("gpt-image-2", 3000, 2000);
    const [w, h] = s.split("x").map(Number);
    expect(w % 16).toBe(0);
    expect(h % 16).toBe(0);
    expect(w).toBe(2048);
    expect(w / h).toBeCloseTo(1.5, 1);
  });
  it("clamps extreme ratios to 3:1", () => {
    const [w, h] = chooseSize("gpt-image-2", 6000, 1000).split("x").map(Number);
    expect(w / h).toBeLessThanOrEqual(3.05);
  });
  it("doesn't upscale small images beyond their size", () => {
    expect(chooseSize("gpt-image-2", 800, 800)).toBe("800x800");
  });
  it("uses standard sizes for gpt-image-1.x models", () => {
    expect(chooseSize("gpt-image-1.5", 3000, 2000)).toBe("1536x1024");
    expect(chooseSize("gpt-image-1.5", 2000, 3000)).toBe("1024x1536");
    expect(chooseSize("gpt-image-1-mini", 1000, 1050)).toBe("1024x1024");
  });
});

describe("provider error mapping", () => {
  it("maps HTTP statuses to human-readable kinds", () => {
    expect(errorFromStatus(429, "slow down", "7").kind).toBe("rate_limit");
    expect(errorFromStatus(429, "", "7").retryAfterMs).toBe(7000);
    expect(errorFromStatus(401).kind).toBe("auth");
    expect(errorFromStatus(413).kind).toBe("too_large");
    expect(errorFromStatus(400, "Your request was rejected by the safety system").kind).toBe("content_policy");
    expect(errorFromStatus(400, "Image file size exceeds limit").kind).toBe("too_large");
    expect(errorFromStatus(400, "bad").kind).toBe("bad_request");
    expect(errorFromStatus(503).kind).toBe("server");
    expect(errorFromStatus(504).kind).toBe("timeout");
  });
  it("marks only transient errors retryable", () => {
    expect(new ProviderError("rate_limit").retryable).toBe(true);
    expect(new ProviderError("server").retryable).toBe(true);
    expect(new ProviderError("auth").retryable).toBe(false);
    expect(new ProviderError("content_policy").retryable).toBe(false);
  });
  it("normalizes thrown errors", () => {
    expect(toProviderError(new Error("fetch failed")).kind).toBe("network");
    expect(toProviderError(Object.assign(new Error("x"), { name: "AbortError" })).kind).toBe("timeout");
    expect(toProviderError("weird").kind).toBe("unknown");
  });
  it("parses Retry-After seconds and dates", () => {
    expect(parseRetryAfter("3")).toBe(3000);
    expect(parseRetryAfter(new Date(Date.now() + 5000).toUTCString())).toBeGreaterThan(3000);
    expect(parseRetryAfter(null)).toBeUndefined();
  });
  it("user messages never include provider internals", () => {
    const e = errorFromStatus(500, "stack trace at foo.js:12");
    expect(e.userMessage).not.toContain("foo.js");
  });
});

describe("mock provider", () => {
  it("returns a tinted copy and can fail", async () => {
    const p = new MockImageEditProvider();
    process.env.MOCK_FAIL_RATE = "0";
    const out = await p.edit({ image: await productPng(), mime: "image/png", width: 300, height: 200, prompt: "x" });
    expect(out.length).toBeGreaterThan(100);
    process.env.MOCK_FAIL_RATE = "1";
    await expect(
      p.edit({ image: await productPng(), mime: "image/png", width: 300, height: 200, prompt: "x" }),
    ).rejects.toBeInstanceOf(ProviderError);
    process.env.MOCK_FAIL_RATE = "0";
  });
});
