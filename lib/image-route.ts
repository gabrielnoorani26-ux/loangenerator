import { notFound } from "./api";
import { prisma } from "./db";

export async function batchIdOf(imageId: string): Promise<string> {
  const img = await prisma.batchImage.findUnique({ where: { id: imageId }, select: { batchId: true } });
  if (!img) throw notFound("Image");
  return img.batchId;
}
