import { requireUser } from "@/server/authz";
import { RateLimitError } from "@/server/errors";
import { clientKey, json, parseWith, readJson, route, searchParamsOf } from "@/server/http";
import { takeToken } from "@/server/rate-limit";
import { createBooking, listCustomerBookings } from "@/server/services/bookings";
import { bookingListQuerySchema, createBookingSchema } from "@/lib/validators";

/** The signed-in customer's own bookings. The customer id always comes from the session. */
export const GET = route(async (req) => {
  const actor = await requireUser();
  const query = parseWith(bookingListQuerySchema, searchParamsOf(req));
  return json(await listCustomerBookings(actor, query));
});

/**
 * Creates a booking. Returns 201 only after the transaction commits, and 409
 * when the slot is already taken — including when a concurrent request wins
 * the race (resolved by the `unique_active_booking_per_slot` index).
 */
export const POST = route(async (req) => {
  const actor = await requireUser();
  const limit = takeToken(`book:${clientKey(req, actor.id)}`, { capacity: 10, refillPerMinute: 10 });
  if (!limit.ok) throw new RateLimitError(limit.retryAfterSeconds);
  const input = parseWith(createBookingSchema, await readJson(req));
  const booking = await createBooking(actor, input);
  return json({ booking }, { status: 201 });
});
