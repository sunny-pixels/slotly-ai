import { z } from "zod";
import { json, parseWith, route, searchParamsOf } from "@/server/http";
import { getAvailabilityCalendar } from "@/server/services/availability";
import { dateKeySchema, idSchema } from "@/lib/validators";

const querySchema = z.object({
  serviceId: idSchema,
  from: dateKeySchema,
  days: z.coerce.number().int().min(1).max(62).default(14),
});

/** Count of bookable slots per day — powers the booking page's date strip. */
export const GET = route(async (req) => {
  const { serviceId, from, days } = parseWith(querySchema, searchParamsOf(req));
  return json({ days: await getAvailabilityCalendar(serviceId, from, days) }, { headers: { "Cache-Control": "no-store" } });
});
