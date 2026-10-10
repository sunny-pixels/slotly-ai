import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { GET as adminServicesGet, POST as adminServicesPost } from "@/app/api/admin/services/route";
import { PATCH as adminServicePatch } from "@/app/api/admin/services/[id]/route";
import { POST as rulesPost } from "@/app/api/admin/availability/route";
import { POST as slotsPost } from "@/app/api/admin/slots/route";
import { PATCH as slotPatch } from "@/app/api/admin/slots/[id]/route";
import { GET as adminBookingsGet } from "@/app/api/admin/bookings/route";
import { GET as docsGet } from "@/app/api/admin/knowledge/documents/route";
import { createBooking } from "@/server/services/bookings";
import { getConfig } from "@/lib/config";
import { addDaysToKey, todayKey } from "@/lib/time";
import { actAs, createService, createSlot, createUser, jsonRequest, params, resetDatabase } from "../support/fixtures";

const newService = { name: "Sports Massage", description: "A firm sports massage for testing.", category: "Wellness", durationMinutes: 45, priceCents: 5500, currency: "INR" };

describe("admin-only management", () => {
  beforeEach(async () => {
    await resetDatabase();
    actAs(null);
  });

  // 11. Admin-only service and availability management
  it("rejects anonymous (401) and customer (403) callers on every admin endpoint", async () => {
    const svc = await createService();
    const slot = await createSlot(svc.id, 48);
    const calls = () => [
      adminServicesGet(jsonRequest("/x", "GET"), undefined),
      adminServicesPost(jsonRequest("/x", "POST", newService), undefined),
      adminServicePatch(jsonRequest("/x", "PATCH", { priceCents: 1 }), params({ id: svc.id })),
      rulesPost(jsonRequest("/x", "POST", { serviceId: svc.id, weekday: 1, openTime: "09:00", closeTime: "17:00", slotIntervalMinutes: 60 }), undefined),
      slotsPost(jsonRequest("/x", "POST", { serviceId: svc.id, from: "2026-12-01", to: "2026-12-02" }), undefined),
      slotPatch(jsonRequest("/x", "PATCH", { status: "BLOCKED" }), params({ id: slot.id })),
      adminBookingsGet(jsonRequest("/x", "GET"), undefined),
      docsGet(jsonRequest("/x", "GET"), undefined),
    ];
    for (const res of await Promise.all(calls())) expect(res.status).toBe(401);
    actAs(await createUser("CUSTOMER"));
    for (const res of await Promise.all(calls())) expect(res.status).toBe(403);

    // Nothing was changed by the rejected calls.
    expect((await prisma.service.findUniqueOrThrow({ where: { id: svc.id } })).priceCents).toBe(6500);
    expect((await prisma.slot.findUniqueOrThrow({ where: { id: slot.id } })).status).toBe("AVAILABLE");
  });

  it("re-checks the role in the database (a demoted admin loses access immediately)", async () => {
    const admin = await createUser("ADMIN");
    actAs(admin);
    expect((await adminServicesGet(jsonRequest("/x", "GET"), undefined)).status).toBe(200);
    await prisma.user.update({ where: { id: admin.id }, data: { role: "CUSTOMER" } });
    expect((await adminServicesGet(jsonRequest("/x", "GET"), undefined)).status).toBe(403);
  });

  it("lets an administrator create a service, add opening hours and generate slots idempotently", async () => {
    actAs(await createUser("ADMIN"));
    const created = await (await adminServicesPost(jsonRequest("/x", "POST", newService), undefined)).json();
    expect(created.service.slug).toBe("sports-massage");

    const rules = [1, 2, 3, 4, 5].map((weekday) =>
      rulesPost(jsonRequest("/x", "POST", { serviceId: created.service.id, weekday, openTime: "09:00", closeTime: "12:00", slotIntervalMinutes: 60 }), undefined),
    );
    for (const r of await Promise.all(rules)) expect(r.status).toBe(201);

    const overlapping = await rulesPost(
      jsonRequest("/x", "POST", { serviceId: created.service.id, weekday: 1, openTime: "11:00", closeTime: "13:00", slotIntervalMinutes: 60 }),
      undefined,
    );
    expect(overlapping.status).toBe(409);

    const tz = getConfig().BUSINESS_TIMEZONE;
    const from = addDaysToKey(todayKey(tz), 1, tz);
    const to = addDaysToKey(from, 13, tz);
    const first = await (await slotsPost(jsonRequest("/x", "POST", { serviceId: created.service.id, from, to }), undefined)).json();
    expect(first.created).toBe(30); // 10 weekdays × 3 slots (09, 10, 11 for a 45-minute service closing at 12)
    const second = await (await slotsPost(jsonRequest("/x", "POST", { serviceId: created.service.id, from, to }), undefined)).json();
    expect(second.created).toBe(0);
    expect(await prisma.slot.count({ where: { serviceId: created.service.id } })).toBe(30);
  });

  it("will not block a slot that has an active booking (409), but blocks free slots", async () => {
    const customer = await createUser();
    const svc = await createService();
    const [bookedSlot, freeSlot] = [await createSlot(svc.id, 48), await createSlot(svc.id, 50)];
    await createBooking(customer, { slotId: bookedSlot.id });

    actAs(await createUser("ADMIN"));
    expect((await slotPatch(jsonRequest("/x", "PATCH", { status: "BLOCKED" }), params({ id: bookedSlot.id }))).status).toBe(409);
    expect((await slotPatch(jsonRequest("/x", "PATCH", { status: "BLOCKED" }), params({ id: freeSlot.id }))).status).toBe(200);
  });

  it("refuses duration changes that would invalidate upcoming bookings; price changes keep booking snapshots", async () => {
    const customer = await createUser();
    const svc = await createService({ priceCents: 6500 });
    const slot = await createSlot(svc.id, 48);
    const booking = await createBooking(customer, { slotId: slot.id });

    actAs(await createUser("ADMIN"));
    const res = await adminServicePatch(jsonRequest("/x", "PATCH", { durationMinutes: 90 }), params({ id: svc.id }));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("SERVICE_HAS_BOOKINGS");

    expect((await adminServicePatch(jsonRequest("/x", "PATCH", { priceCents: 7000 }), params({ id: svc.id }))).status).toBe(200);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).priceCents).toBe(6500);

    // Deactivation keeps existing bookings.
    expect((await adminServicePatch(jsonRequest("/x", "PATCH", { isActive: false }), params({ id: svc.id }))).status).toBe(200);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("CONFIRMED");
  });
});
