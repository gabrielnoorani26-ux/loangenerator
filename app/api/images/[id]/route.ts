import { z } from "zod";
import { notFound, ok, parseBody, route } from "@/lib/api";
import { prisma } from "@/lib/db";
import { recountBatch, serializeImage, VIEW_ANGLES } from "@/lib/batches";
import { deleteWithThumb } from "@/lib/files";

type Ctx = RouteContext<"/api/images/[id]">;

const Patch = z.object({
  styleCode: z.string().trim().max(60).nullable().optional(),
  colorName: z.string().trim().max(60).nullable().optional(),
  viewAngle: z.enum(VIEW_ANGLES).nullable().optional(),
  perImageInstruction: z.string().trim().max(500).nullable().optional(),
});

export const GET = route(async (_req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const image = await prisma.batchImage.findUnique({
    where: { id },
    include: { versions: { orderBy: { createdAt: "desc" } } },
  });
  if (!image) throw notFound("Image");
  return ok({
    image: serializeImage(image),
    versions: image.versions.map((v) => ({
      id: v.id,
      editedUrl: `/api/files/${v.editedKey}`,
      thumbUrl: `/api/files/${v.editedKey.replace(/\.[A-Za-z0-9]+$/, "")}.thumb.webp`,
      instruction: v.instruction,
      qcScore: v.qcScore,
      outputWidth: v.outputWidth,
      outputHeight: v.outputHeight,
      outputSizeKb: v.outputSizeKb,
      createdAt: v.createdAt,
    })),
  });
});

export const PATCH = route(async (req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, Patch);
  if (!(await prisma.batchImage.findUnique({ where: { id }, select: { id: true } }))) throw notFound("Image");
  const image = await prisma.batchImage.update({
    where: { id },
    data: {
      styleCode: body.styleCode === "" ? null : body.styleCode,
      colorName: body.colorName === "" ? null : body.colorName,
      viewAngle: body.viewAngle,
      perImageInstruction: body.perImageInstruction === "" ? null : body.perImageInstruction,
    },
  });
  return ok({ image: serializeImage(image) });
});

/** Removes the image from its batch, including its stored files and versions. */
export const DELETE = route(async (_req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const image = await prisma.batchImage.findUnique({ where: { id }, include: { versions: true } });
  if (!image) throw notFound("Image");
  await prisma.$transaction(async (tx) => {
    await tx.batchImage.delete({ where: { id } });
    await recountBatch(image.batchId, tx);
  });
  await Promise.all([
    deleteWithThumb(image.originalKey),
    deleteWithThumb(image.aiIntermediateKey),
    deleteWithThumb(image.editedKey),
    ...image.versions.map((v) => deleteWithThumb(v.editedKey)),
  ]);
  return ok({ ok: true });
});
