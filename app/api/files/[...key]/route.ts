import { Readable } from "node:stream";
import { errorResponse } from "@/lib/api";
import { contentTypeForKey } from "@/lib/mime";
import { LocalStorageAdapter, sanitizeKey, storage } from "@/lib/storage";

/** Serves stored files. Keys are validated so requests can never escape STORAGE_DIR. */
export async function GET(_req: Request, ctx: RouteContext<"/api/files/[...key]">) {
  const { key: parts } = await ctx.params;
  const key = sanitizeKey(parts.map((p) => decodeURIComponent(p)).join("/"));
  if (!key) return errorResponse(400, "invalid_key", "Invalid file path");

  const store = storage();
  if (!(await store.exists(key))) return errorResponse(404, "not_found", "File not found");

  const download = new URL(_req.url).searchParams.get("download");
  const headers: Record<string, string> = {
    "Content-Type": contentTypeForKey(key),
    // Keys are content-addressed or timestamped, so they never change once written.
    "Cache-Control": "private, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  };
  if (download) {
    const safeName = download.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 200) || "download";
    headers["Content-Disposition"] = `attachment; filename="${safeName}"`;
  }
  if (store instanceof LocalStorageAdapter) {
    const stream = Readable.toWeb(store.getStream(key)) as ReadableStream;
    return new Response(stream, { headers });
  }
  return new Response(new Uint8Array(await store.get(key)), { headers });
}
