import { z } from "zod";
import { badRequest, IdParam, notFound, ok, parseQuery, route } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { partCount, planPart, selectForExport, streamZip } from "@/lib/export";
import { sanitizeFilenamePart } from "@/lib/naming";
import { storage } from "@/lib/storage";

const bool = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");
const Query = z.object({
  scope: z.enum(["approved", "done", "selected"]).default("approved"),
  ids: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").filter(Boolean) : undefined))
    .pipe(z.array(IdParam).max(1000).optional()),
  group: z.enum(["flat", "style", "view", "color"]).default("flat"),
  originals: bool.default(false),
  manifest: bool.default(true),
  part: z.coerce.number().int().min(1).optional(),
});

/**
 * Without `part`: returns {parts, total} so the client can download each part.
 * With `part=N`: streams that ZIP part.
 */
export const GET = route(async (req, ctx: RouteContext<"/api/batches/[id]/export">) => {
  const { id } = await ctx.params;
  const q = parseQuery(req, Query);
  const batch = await prisma.batch.findUnique({ where: { id } });
  if (!batch) throw notFound("Batch");
  if (q.scope === "selected" && !q.ids?.length) throw badRequest("Select at least one image to export");
  const images = await prisma.batchImage.findMany({ where: { batchId: id } });
  const selected = selectForExport(images, q.scope, q.ids);
  const parts = partCount(selected.length);
  if (q.part === undefined) return ok({ parts, total: selected.length });
  if (selected.length === 0) throw badRequest("No images match this export scope");
  if (q.part > parts) throw badRequest(`Part ${q.part} does not exist (there are ${parts})`);

  const { entries, manifest } = planPart(selected, q, q.part);
  const base = sanitizeFilenamePart(batch.name) || "batch";
  const filename = parts > 1 ? `${base}_part${q.part}of${parts}.zip` : `${base}.zip`;
  if (q.part === 1) await logActivity("batch.exported", `${selected.length} image(s) · ${q.scope} · ${q.group}${parts > 1 ? ` · ${parts} parts` : ""}`, id);
  return new Response(streamZip(entries, manifest, storage()), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Export-Parts": String(parts),
    },
  });
});
