import { requireUser } from "@/server/authz";
import { json, parseWith, route } from "@/server/http";
import { cancelBooking } from "@/server/services/bookings";
import { idSchema } from "@/lib/validators";

/** Idempotent: cancelling an already-cancelled booking returns 200 with `alreadyCancelled: true`. */
export const PATCH = route<{ params: Promise<{ id: string }> }>(async (_req, { params }) => {
  const actor = await requireUser();
  const id = parseWith(idSchema, (await params).id);
  return json(await cancelBooking(actor, id));
});
