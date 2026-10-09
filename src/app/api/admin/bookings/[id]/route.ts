import { requireAdmin } from "@/server/authz";
import { json, parseWith, readJson, route } from "@/server/http";
import { cancelBooking, completeBooking, getBookingForActor } from "@/server/services/bookings";
import { adminBookingActionSchema, idSchema } from "@/lib/validators";

export const GET = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const actor = await requireAdmin();
  return json({ booking: await getBookingForActor(actor, parseWith(idSchema, (await params).id)) });
});

/** Administrative state transitions: cancel (any time) or complete (after the start time). */
export const PATCH = route<{ params: Promise<{ id: string }> }>(async (req, { params }) => {
  const actor = await requireAdmin();
  const id = parseWith(idSchema, (await params).id);
  const { action } = parseWith(adminBookingActionSchema, await readJson(req));
  if (action === "cancel") return json(await cancelBooking(actor, id));
  return json({ booking: await completeBooking(actor, id) });
});
