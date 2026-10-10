import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { REQUIRED_CHECKS } from "../../scripts/verify-db";
import { createService, createSlot, createUser, resetDatabase } from "../support/fixtures";

describe("database-level integrity", () => {
  beforeEach(resetDatabase);

  it.each(REQUIRED_CHECKS.map((c) => [c.name, c.sql] as const))("migration created: %s", async (_name, sql) => {
    const rows = await prisma.$queryRawUnsafe<unknown[]>(sql);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("rejects a second ACTIVE booking for a slot even when inserted directly (bypassing the app)", async () => {
    const [a, b] = [await createUser(), await createUser()];
    const svc = await createService();
    const slot = await createSlot(svc.id, 48);
    await prisma.$executeRaw`INSERT INTO bookings (id, public_reference, slot_id, customer_id, status, price_cents, currency, updated_at)
                             VALUES ('raw-1', 'SLT-RAW001', ${slot.id}, ${a.id}, 'CONFIRMED', 100, 'INR', now())`;
    await expect(
      prisma.$executeRaw`INSERT INTO bookings (id, public_reference, slot_id, customer_id, status, price_cents, currency, updated_at)
                         VALUES ('raw-2', 'SLT-RAW002', ${slot.id}, ${b.id}, 'PENDING', 100, 'INR', now())`,
    ).rejects.toThrow(/unique_active_booking_per_slot|23505|Unique constraint/i);
  });

  it("allows any number of CANCELLED bookings plus one active booking on the same slot", async () => {
    const user = await createUser();
    const svc = await createService();
    const slot = await createSlot(svc.id, 48);
    for (let i = 0; i < 3; i++) {
      await prisma.booking.create({
        data: { publicReference: `SLT-CXL00${i}`, slotId: slot.id, customerId: user.id, status: "CANCELLED", cancelledAt: new Date(), priceCents: 1, currency: "INR" },
      });
    }
    await expect(
      prisma.booking.create({ data: { publicReference: "SLT-ACTIVE", slotId: slot.id, customerId: user.id, status: "CONFIRMED", priceCents: 1, currency: "INR" } }),
    ).resolves.toBeTruthy();
  });

  it("rejects overlapping slots for the same service but allows back-to-back slots", async () => {
    const svc = await createService();
    const first = await createSlot(svc.id, 72); // 60 minutes
    await expect(
      prisma.slot.create({
        data: { serviceId: svc.id, startAt: new Date(first.startAt.getTime() + 30 * 60_000), endAt: new Date(first.endAt.getTime() + 30 * 60_000) },
      }),
    ).rejects.toThrow();
    await expect(prisma.slot.create({ data: { serviceId: svc.id, startAt: first.endAt, endAt: new Date(first.endAt.getTime() + 3_600_000) } })).resolves.toBeTruthy();
  });

  it("rejects invalid intervals and negative prices", async () => {
    const svc = await createService();
    const t = new Date(Date.now() + 86_400_000);
    await expect(prisma.slot.create({ data: { serviceId: svc.id, startAt: t, endAt: t } })).rejects.toThrow();
    await expect(createService({ priceCents: -1 })).rejects.toThrow();
  });

  it("requires a cancellation timestamp on cancelled bookings", async () => {
    const user = await createUser();
    const svc = await createService();
    const slot = await createSlot(svc.id, 48);
    await expect(
      prisma.booking.create({ data: { publicReference: "SLT-NOTIME", slotId: slot.id, customerId: user.id, status: "CANCELLED", priceCents: 1, currency: "INR" } }),
    ).rejects.toThrow();
  });
});
