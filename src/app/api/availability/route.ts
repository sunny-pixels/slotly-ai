import { json, parseWith, route, searchParamsOf } from "@/server/http";
import { getDayAvailability } from "@/server/services/availability";
import { availabilityQuerySchema } from "@/lib/validators";

/** Live slot states for one service and business-local day. Never cached. */
export const GET = route(async (req) => {
  const { serviceId, date } = parseWith(availabilityQuerySchema, searchParamsOf(req));
  return json(await getDayAvailability(serviceId, date), { headers: { "Cache-Control": "no-store" } });
});
