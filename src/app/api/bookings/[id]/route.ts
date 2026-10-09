import { requireUser } from "@/server/authz";
import { json, parseWith, route } from "@/server/http";
import { getBookingForActor } from "@/server/services/bookings";
import { idSchema } from "@/lib/validators";

/** Ownership is enforced in the query: another customer's booking is reported as 404. */
export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const actor = await requireUser();
  const id = parseWith(idSchema, (await params).id);
  return json({ booking: await getBookingForActor(actor, id) });
});
