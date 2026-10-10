import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { resetRateLimits } from "@/server/rate-limit";
import { GET as listServicesRoute } from "@/app/api/services/route";
import { GET as availabilityRoute } from "@/app/api/availability/route";
import { GET as listBookingsRoute, POST as createBookingRoute } from "@/app/api/bookings/route";
import { GET as getBookingRoute } from "@/app/api/bookings/[id]/route";
import { PATCH as cancelRoute } from "@/app/api/bookings/[id]/cancel/route";
import { actAs, createService, createSlot, createUser, jsonRequest, params, resetDatabase } from "../support/fixtures";
import { getConfig } from "@/lib/config";
import { toDateKey } from "@/lib/time";

async function book(slotId: string) {
  return createBookingRoute(jsonRequest("/api/bookings", "POST", { slotId }), undefined);
}

describe("booking API", () => {
  beforeEach(async () => {
    await resetDatabase();
    resetRateLimits();
    actAs(null);
  });

  // 1. Service listing
  it("lists only active services, with filters and the next available time", async () => {
    const svc = await createService({ name: "Active Massage", priceCents: 5000 });
    await createService({ name: "Retired Service", isActive: false });
    await createService({ name: "Pricey Strategy", priceCents: 20000, category: "Consulting" });
    const slot = await createSlot(svc.id, 30);

    const res = await listServicesRoute(jsonRequest("/api/services", "GET"), undefined);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.items.map((s: { name: string }) => s.name).sort()).toEqual(["Active Massage", "Pricey Strategy"]);
    expect(body.items.find((s: { id: string }) => s.id === svc.id).nextAvailableAt).toBe(slot.startAt.toISOString());

    const cheap = await (await listServicesRoute(jsonRequest("/api/services?maxPrice=60", "GET"), undefined)).json();
    expect(cheap.items.map((s: { name: string }) => s.name)).toEqual(["Active Massage"]);
  });

  // 2. Available slot retrieval
  it("returns live slot states for a day: available, booked, blocked", async () => {
    const svc = await createService();
    const tz = getConfig().BUSINESS_TIMEZONE;
    const open = await createSlot(svc.id, 50);
    const taken = await createSlot(svc.id, 52);
    const blocked = await createSlot(svc.id, 54, { status: "BLOCKED" });
    const someone = await createUser();
    await prisma.booking.create({ data: { publicReference: "SLT-TAKEN1", slotId: taken.id, customerId: someone.id, priceCents: 1, currency: "INR" } });

    const date = toDateKey(open.startAt, tz);
    const res = await availabilityRoute(jsonRequest(`/api/availability?serviceId=${svc.id}&date=${date}`, "GET"), undefined);
    expect(res.status).toBe(200);
    const body = await res.json();
    const state = (id: string) => body.slots.find((s: { id: string }) => s.id === id)?.state;
    expect(state(open.id)).toBe("available");
    if (toDateKey(taken.startAt, tz) === date) expect(state(taken.id)).toBe("booked");
    if (toDateKey(blocked.startAt, tz) === date) expect(state(blocked.id)).toBe("blocked");
  });

  it("rejects malformed availability queries with 400", async () => {
    const res = await availabilityRoute(jsonRequest("/api/availability?serviceId=x&date=09-10-2026", "GET"), undefined);
    expect(res.status).toBe(400);
  });

  // 3. Successful booking
  it("creates a confirmed booking with a price snapshot for the signed-in customer", async () => {
    const user = await createUser();
    const svc = await createService({ priceCents: 6500 });
    const slot = await createSlot(svc.id, 48);
    actAs(user);

    const res = await book(slot.id);
    expect(res.status).toBe(201);
    const { booking } = await res.json();
    expect(booking).toMatchObject({ status: "CONFIRMED", priceCents: 6500, currency: "INR" });
    expect(booking.publicReference).toMatch(/^SLT-[A-Z0-9]{6}$/);

    const row = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(row.customerId).toBe(user.id);

    // Later price changes do not alter the booking.
    await prisma.service.update({ where: { id: svc.id }, data: { priceCents: 9900 } });
    const again = await (await getBookingRoute(jsonRequest(`/api/bookings/${booking.id}`, "GET"), params({ id: booking.id }))).json();
    expect(again.booking.priceCents).toBe(6500);
  });

  it("ignores any customerId in the body — identity comes only from the session", async () => {
    const [me, victim] = [await createUser(), await createUser()];
    const svc = await createService();
    const slot = await createSlot(svc.id, 48);
    actAs(me);
    const res = await createBookingRoute(jsonRequest("/api/bookings", "POST", { slotId: slot.id, customerId: victim.id }), undefined);
    expect(res.status).toBe(201);
    const { booking } = await res.json();
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).customerId).toBe(me.id);
  });

  // 4. Duplicate booking rejection
  it("rejects a second booking of the same slot with 409", async () => {
    const [a, b] = [await createUser(), await createUser()];
    const svc = await createService();
    const slot = await createSlot(svc.id, 48);
    actAs(a);
    expect((await book(slot.id)).status).toBe(201);
    actAs(b);
    const res = await book(slot.id);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("SLOT_TAKEN");
    expect(await prisma.booking.count({ where: { slotId: slot.id } })).toBe(1);
  });

  // 6 & 7. Cancellation and rebooking
  it("cancels a booking, releases the slot, and lets another customer book it", async () => {
    const [a, b] = [await createUser(), await createUser()];
    const svc = await createService();
    const slot = await createSlot(svc.id, 72);
    actAs(a);
    const { booking } = await (await book(slot.id)).json();

    const res = await cancelRoute(jsonRequest(`/api/bookings/${booking.id}/cancel`, "PATCH"), params({ id: booking.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.booking.status).toBe("CANCELLED");
    expect(body.alreadyCancelled).toBe(false);

    // Repeating the cancellation is safe and idempotent.
    const repeat = await (await cancelRoute(jsonRequest(`/api/bookings/${booking.id}/cancel`, "PATCH"), params({ id: booking.id }))).json();
    expect(repeat.alreadyCancelled).toBe(true);

    actAs(b);
    expect((await book(slot.id)).status).toBe(201);
    expect(await prisma.booking.count({ where: { slotId: slot.id, status: "CONFIRMED" } })).toBe(1);
  });

  it("refuses customer cancellation inside the 24-hour window (422) but allows it for admins", async () => {
    const user = await createUser();
    const admin = await createUser("ADMIN");
    const svc = await createService();
    const slot = await createSlot(svc.id, 5);
    actAs(user);
    const { booking } = await (await book(slot.id)).json();

    const res = await cancelRoute(jsonRequest("/x", "PATCH"), params({ id: booking.id }));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("CANCELLATION_WINDOW_CLOSED");

    const { PATCH: adminPatch } = await import("@/app/api/admin/bookings/[id]/route");
    actAs(admin);
    const adminRes = await adminPatch(jsonRequest("/x", "PATCH", { action: "cancel" }), params({ id: booking.id }));
    expect(adminRes.status).toBe(200);
  });

  // 8. Unauthorized cancellation
  it("does not let a customer cancel someone else's booking (404, booking untouched)", async () => {
    const [owner, intruder] = [await createUser(), await createUser()];
    const svc = await createService();
    const slot = await createSlot(svc.id, 72);
    actAs(owner);
    const { booking } = await (await book(slot.id)).json();

    actAs(intruder);
    const res = await cancelRoute(jsonRequest("/x", "PATCH"), params({ id: booking.id }));
    expect(res.status).toBe(404);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("CONFIRMED");

    actAs(null);
    expect((await cancelRoute(jsonRequest("/x", "PATCH"), params({ id: booking.id }))).status).toBe(401);
  });

  // 9. Accessing another customer's booking
  it("hides other customers' bookings from detail and list endpoints", async () => {
    const [owner, other] = [await createUser(), await createUser()];
    const svc = await createService();
    const slot = await createSlot(svc.id, 72);
    actAs(owner);
    const { booking } = await (await book(slot.id)).json();

    actAs(other);
    expect((await getBookingRoute(jsonRequest("/x", "GET"), params({ id: booking.id }))).status).toBe(404);
    expect((await getBookingRoute(jsonRequest("/x", "GET"), params({ id: booking.publicReference }))).status).toBe(404);
    const list = await (await listBookingsRoute(jsonRequest("/api/bookings?view=all", "GET"), undefined)).json();
    expect(list.items).toHaveLength(0);

    actAs(owner);
    const mine = await (await listBookingsRoute(jsonRequest("/api/bookings?view=upcoming", "GET"), undefined)).json();
    expect(mine.items.map((b: { id: string }) => b.id)).toEqual([booking.id]);
  });

  it("requires authentication to book", async () => {
    const svc = await createService();
    const slot = await createSlot(svc.id, 48);
    expect((await book(slot.id)).status).toBe(401);
  });

  // 10. Invalid and past slots
  it("rejects past, too-soon, blocked, inactive and unknown slots", async () => {
    const user = await createUser();
    const svc = await createService();
    actAs(user);

    const past = await createSlot(svc.id, -24);
    const r1 = await book(past.id);
    expect(r1.status).toBe(422);
    expect((await r1.json()).error.code).toBe("SLOT_CLOSED");

    const soon = await createSlot(svc.id, 0.4); // inside the 60-minute online booking cut-off
    expect((await book(soon.id)).status).toBe(422);

    const blocked = await createSlot(svc.id, 30, { status: "BLOCKED" });
    expect((await book(blocked.id)).status).toBe(422);

    const inactiveSvc = await createService({ isActive: false });
    const inactiveSlot = await createSlot(inactiveSvc.id, 30);
    expect((await book(inactiveSlot.id)).status).toBe(422);

    expect((await book("does-not-exist")).status).toBe(404);
  });

  it("returns 400 for malformed JSON and invalid bodies", async () => {
    actAs(await createUser());
    expect((await createBookingRoute(jsonRequest("/api/bookings", "POST", "{not json"), undefined)).status).toBe(400);
    expect((await createBookingRoute(jsonRequest("/api/bookings", "POST", { slotId: "" }), undefined)).status).toBe(400);
    expect((await createBookingRoute(jsonRequest("/api/bookings", "POST", { slotId: "x'; DROP TABLE bookings;--" }), undefined)).status).toBe(400);
  });
});
