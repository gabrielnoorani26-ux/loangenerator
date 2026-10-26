import { z } from "zod";
import { notFound, ok, parseBody, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { serializeImage } from "@/lib/batches";
import { parseFilename } from "@/lib/smart-fill";

const Body = z.object({ overwrite: z.boolean().default(true) });

export const POST = route(async (req, ctx: RouteContext<"/api/batches/[id]/smart-fill">) => {
  const { id } = await ctx.params;
  const { overwrite } = await parseBody(req, Body);
  const images = await prisma.batchImage.findMany({ where: { batchId: id }, orderBy: { sortOrder: "asc" } });
  if (!(await prisma.batch.findUnique({ where: { id }, select: { id: true } }))) throw notFound("Batch");
  let filled = 0;
  const updated = await prisma.$transaction(
    images.map((img) => {
      const p = parseFilename(img.originalFilename);
      const data = {
        styleCode: overwrite ? (p.styleCode ?? img.styleCode) : (img.styleCode ?? p.styleCode),
        colorName: overwrite ? (p.colorName ?? img.colorName) : (img.colorName ?? p.colorName),
        viewAngle: overwrite ? (p.viewAngle ?? img.viewAngle) : (img.viewAngle ?? p.viewAngle),
      };
      if (p.styleCode || p.colorName || p.viewAngle) filled++;
      return prisma.batchImage.update({ where: { id: img.id }, data });
    }),
  );
  return ok({ filled, images: updated.map(serializeImage) });
});
