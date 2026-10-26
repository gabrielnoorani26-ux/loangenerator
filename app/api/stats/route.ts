import { ok, route } from "@/lib/api";
import { getStats } from "@/lib/stats";

export const GET = route(async () => ok(await getStats()));
