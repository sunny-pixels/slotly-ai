import { requireAdmin } from "@/server/authz";
import { json, parseWith, route, searchParamsOf } from "@/server/http";
import { listAdminBookings } from "@/server/services/bookings";
import { getConfig } from "@/lib/config";
import { dayRange } from "@/lib/time";
import { adminBookingListQuerySchema } from "@/lib/validators";

export const GET = route(async (req) => {
  const actor = await requireAdmin();
  const q = parseWith(adminBookingListQuerySchema, searchParamsOf(req));
  const tz = getConfig().BUSINESS_TIMEZONE;
  return json(
    await listAdminBookings(actor, {
      ...q,
      from: q.from ? dayRange(q.from, tz).start : undefined,
      to: q.to ? dayRange(q.to, tz).end : undefined,
    }),
  );
});
