import { z } from "zod";
import { IdList, ok, parseBody, route } from "@/lib/api";
import { deleteImages, reapplyStandard, rerunAi, setReviewStatus, useOriginal } from "@/lib/image-actions";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve"), ids: IdList }),
  z.object({ action: z.literal("reject"), ids: IdList }),
  z.object({ action: z.literal("rerun-ai"), ids: IdList, instruction: z.string().trim().max(500).nullable().optional() }),
  z.object({ action: z.literal("reapply-standard"), ids: IdList }),
  z.object({ action: z.literal("use-original"), ids: IdList, value: z.boolean().default(true) }),
  z.object({ action: z.literal("delete"), ids: IdList }),
]);

export const POST = route(async (req, ctx: RouteContext<"/api/batches/[id]/images/bulk">) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, Body);
  let affected = 0;
  switch (body.action) {
    case "approve":
    case "reject":
      affected = await setReviewStatus(id, body.ids, body.action === "approve" ? "APPROVED" : "REJECTED");
      break;
    case "rerun-ai":
      affected = await rerunAi(id, body.ids, body.instruction);
      break;
    case "reapply-standard":
      affected = await reapplyStandard(id, body.ids);
      break;
    case "use-original":
      affected = await useOriginal(id, body.ids, body.value);
      break;
    case "delete":
      affected = await deleteImages(id, body.ids);
      break;
  }
  return ok({ affected });
});
