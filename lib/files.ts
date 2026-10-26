import fsp from "node:fs/promises";
import path from "node:path";
import { env } from "./env";
import { sanitizeKey, storage, thumbKeyFor } from "./storage";

/** Remove all stored files of a batch (only called when the batch itself is deleted). */
export async function deleteBatchFiles(batchId: string) {
  const safe = sanitizeKey(`batches/${batchId}`);
  if (!safe) return;
  await fsp.rm(path.join(env.storageDir, safe), { recursive: true, force: true });
}

/** Delete a stored file and its thumbnail, ignoring errors. */
export async function deleteWithThumb(key: string | null | undefined) {
  if (!key) return;
  const store = storage();
  await Promise.allSettled([store.delete(key), store.delete(thumbKeyFor(key))]);
}
