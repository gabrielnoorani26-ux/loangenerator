import { ApiError, conflict, notFound, ok, route } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { recountBatch, serializeImage } from "@/lib/batches";
import { env } from "@/lib/env";
import { ingestImage, makeThumbnail, UploadValidationError } from "@/lib/ingest";
import { parseFilename } from "@/lib/smart-fill";
import { keys, storage, thumbKeyFor } from "@/lib/storage";
import { createId } from "@/lib/ids";

type Ctx = RouteContext<"/api/batches/[id]/images">;

export const GET = route(async (_req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const batch = await prisma.batch.findUnique({ where: { id }, select: { id: true } });
  if (!batch) throw notFound("Batch");
  const images = await prisma.batchImage.findMany({ where: { batchId: id }, orderBy: { sortOrder: "asc" } });
  return ok({ images: images.map(serializeImage) });
});

/**
 * Multipart upload. The client sends one file per request (5 in parallel) so
 * each file gets its own progress and error; multiple files per request also work.
 */
export const POST = route(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const batch = await prisma.batch.findUnique({ where: { id } });
  if (!batch) throw notFound("Batch");
  if (batch.status !== "DRAFT" && batch.status !== "READY" && batch.status !== "REVIEW")
    throw conflict("Images can only be added before processing starts or during review");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ApiError(400, "invalid_upload", "Upload must be multipart/form-data");
  }
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) throw new ApiError(400, "no_files", "No files were uploaded");

  const maxBytes = env.maxUploadMb * 1024 * 1024;
  const results: { filename: string; image?: ReturnType<typeof serializeImage>; error?: string; duplicate?: boolean }[] = [];
  for (const file of files) {
    const filename = file.name.replace(/^.*[\\/]/, "").slice(0, 200) || "image";
    try {
      const ingested = await ingestImage(Buffer.from(await file.arrayBuffer()), filename, maxBytes);
      const imageId = createId();
      const key = keys.original(id, imageId, ingested.ext);
      await storage().put(key, ingested.data);
      await storage().put(thumbKeyFor(key), await makeThumbnail(ingested.data));
      const storedName = ingested.convertedFromHeic ? filename.replace(/\.(heic|heif)$/i, ".jpg") : filename;
      const duplicate = (await prisma.batchImage.count({ where: { batchId: id, originalFilename: storedName } })) > 0;
      const parsed = parseFilename(storedName);
      const image = await prisma.$transaction(async (tx) => {
        const max = await tx.batchImage.aggregate({ where: { batchId: id }, _max: { sortOrder: true } });
        const created = await tx.batchImage.create({
          data: {
            id: imageId,
            batchId: id,
            sortOrder: (max._max.sortOrder ?? -1) + 1,
            originalKey: key,
            originalFilename: storedName,
            originalWidth: ingested.width,
            originalHeight: ingested.height,
            originalSizeKb: ingested.sizeKb,
            originalMime: ingested.mime,
            // Metadata is pre-filled from the filename; the user can edit or re-run smart fill.
            styleCode: parsed.styleCode,
            colorName: parsed.colorName,
            viewAngle: parsed.viewAngle,
            status: "QUEUED",
          },
        });
        await recountBatch(id, tx);
        return created;
      });
      results.push({ filename: storedName, image: serializeImage(image), duplicate });
    } catch (err) {
      if (err instanceof UploadValidationError) {
        results.push({ filename, error: err.message });
      } else {
        console.error("[upload] failed", err);
        results.push({ filename, error: `${filename}: upload failed — please try again` });
      }
    }
  }
  const okCount = results.filter((r) => r.image).length;
  if (okCount > 0 && files.length > 1) await logActivity("images.uploaded", `${okCount} image(s) uploaded`, id);
  const status = okCount === 0 ? 422 : 200;
  if (status === 422) {
    return Response.json(
      { error: { code: "upload_rejected", message: results[0]?.error ?? "Upload rejected" }, results },
      { status },
    );
  }
  return ok({ results });
});
