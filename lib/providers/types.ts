/**
 * Provider interfaces. Add a new AI provider by implementing ImageEditProvider
 * and registering it in ./index.ts (see README → "Adding a provider").
 */
export interface ImageEditRequest {
  /** Source image (PNG or JPEG), already downscaled to ≤4096px longest side */
  image: Buffer;
  mime: "image/png" | "image/jpeg";
  width: number;
  height: number;
  /** Full prompt from lib/prompt-builder (includes the Product Preservation Rule) */
  prompt: string;
  signal?: AbortSignal;
}

export interface ImageEditProvider {
  readonly name: string;
  /** Returns the edited image as PNG/JPEG/WEBP bytes. Throws ProviderError on failure. */
  edit(req: ImageEditRequest): Promise<Buffer>;
  /** Cheapest possible authenticated request, for Settings → "Test API connections". */
  testConnection(): Promise<void>;
}

export interface BackgroundRemovalProvider {
  readonly name: string;
  /** Remove the background and return the product on pure white (#FFFFFF). */
  removeToWhite(image: Buffer, signal?: AbortSignal): Promise<Buffer>;
  testConnection(): Promise<void>;
}

export type ProviderErrorKind =
  | "rate_limit"
  | "content_policy"
  | "too_large"
  | "timeout"
  | "auth"
  | "bad_request"
  | "server"
  | "network"
  | "not_configured"
  | "unknown";

const MESSAGES: Record<ProviderErrorKind, string> = {
  rate_limit: "The AI provider is rate-limiting requests. It will be retried automatically.",
  content_policy: "The AI provider declined this image under its content policy.",
  too_large: "The image is too large for the AI provider.",
  timeout: "The AI provider took too long to respond.",
  auth: "The AI provider rejected the API key. Check IMAGE_PROVIDER_API_KEY in .env.",
  bad_request: "The AI provider rejected the request.",
  server: "The AI provider had a temporary server error.",
  network: "Could not reach the AI provider (network error).",
  not_configured: "No API key is configured for the AI provider.",
  unknown: "The AI edit failed for an unknown reason.",
};

const RETRYABLE: ReadonlySet<ProviderErrorKind> = new Set(["rate_limit", "timeout", "server", "network", "unknown"]);

export class ProviderError extends Error {
  readonly retryable: boolean;
  constructor(
    readonly kind: ProviderErrorKind,
    detail?: string,
    readonly retryAfterMs?: number,
    readonly status?: number,
  ) {
    super(detail ? `${MESSAGES[kind]} (${detail.slice(0, 200)})` : MESSAGES[kind]);
    this.name = "ProviderError";
    this.retryable = RETRYABLE.has(kind);
  }
  /** Short message for the UI (no provider internals). */
  get userMessage(): string {
    return MESSAGES[this.kind];
  }
}

/** Map an HTTP status (+ provider message) to a ProviderError. */
export function errorFromStatus(status: number, message = "", retryAfterHeader?: string | null): ProviderError {
  const msg = message.toLowerCase();
  const retryAfterMs = parseRetryAfter(retryAfterHeader);
  if (status === 429) return new ProviderError("rate_limit", message, retryAfterMs, status);
  if (status === 401 || status === 403) return new ProviderError("auth", message, undefined, status);
  if (status === 413) return new ProviderError("too_large", message, undefined, status);
  if (status === 408 || status === 504) return new ProviderError("timeout", message, undefined, status);
  if (status >= 500) return new ProviderError("server", message, retryAfterMs, status);
  if (/safety|content.?policy|moderation|not allowed|flagged/.test(msg))
    return new ProviderError("content_policy", message, undefined, status);
  if (/too large|file size|dimensions|exceeds/.test(msg))
    return new ProviderError("too_large", message, undefined, status);
  if (status >= 400) return new ProviderError("bad_request", message, undefined, status);
  return new ProviderError("unknown", message, undefined, status);
}

export function parseRetryAfter(value?: string | null): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

/** Normalize anything thrown by a provider into a ProviderError. */
export function toProviderError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err instanceof Error) {
    if (err.name === "AbortError" || /timed? ?out/i.test(err.message)) return new ProviderError("timeout", err.message);
    if (/ECONNRESET|ENOTFOUND|ECONNREFUSED|fetch failed|socket/i.test(err.message))
      return new ProviderError("network", err.message);
    return new ProviderError("unknown", err.message);
  }
  return new ProviderError("unknown", String(err));
}
