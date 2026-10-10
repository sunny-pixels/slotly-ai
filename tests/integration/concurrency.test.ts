import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient, prisma, type Db } from "@/server/db";
import { createBooking } from "@/server/services/bookings";
import { ConflictError } from "@/server/errors";
import { createService, createSlot, createUser, resetDatabase } from "../support/fixtures";

/**
 * Genuine concurrency against the real PostgreSQL test database.
 * Each competing request uses its OWN PrismaClient (its own connection pool),
 * so the transactions really run in parallel on separate database sessions.
 */
const clients: Db[] = [];
function freshClient() {
  const c = createPrismaClient(process.env.TEST_DATABASE_URL);
  clients.push(c);
  return c;
}

afterAll(async () => {
  await Promise.all(clients.map((c) => c.$disconnect()));
});

async function activeBookings(slotId: string) {
  return prisma.booking.count({ where: { slotId, status: { in: ["PENDING", "CONFIRMED"] } } });
}

describe("concurrent booking of the same slot", () => {
  beforeEach(resetDatabase);

  it("two simultaneous requests: exactly one succeeds, the other gets a 409 conflict", async () => {
    const [alice, bob] = [await createUser("CUSTOMER", "Alice"), await createUser("CUSTOMER", "Bob")];
    const svc = await createService();
    const slot = await createSlot(svc.id, 72);
    const [dbA, dbB] = [freshClient(), freshClient()];
    // Warm both connections so neither request is delayed by connection setup.
    await Promise.all([dbA.$queryRaw`SELECT 1`, dbB.$queryRaw`SELECT 1`]);

    const results = await Promise.allSettled([
      createBooking(alice, { slotId: slot.id }, dbA),
      createBooking(bob, { slotId: slot.id }, dbB),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(ConflictError);
    expect((rejected[0].reason as ConflictError).status).toBe(409);

    expect(await activeBookings(slot.id)).toBe(1);
    expect(await prisma.booking.count({ where: { slotId: slot.id } })).toBe(1); // no stray/duplicate rows
  });

  it("ten simultaneous requests from ten customers: exactly one booking exists afterwards", async () => {
    const users = await Promise.all(Array.from({ length: 10 }, (_, i) => createUser("CUSTOMER", `Racer ${i}`)));
    const svc = await createService();
    const slot = await createSlot(svc.id, 96);
    const dbs = users.map(() => freshClient());
    await Promise.all(dbs.map((db) => db.$queryRaw`SELECT 1`));

    const results = await Promise.allSettled(users.map((u, i) => createBooking(u, { slotId: slot.id }, dbs[i])));

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(failures).toHaveLength(9);
    for (const f of failures) expect(f.reason).toBeInstanceOf(ConflictError);
    expect(await prisma.booking.count({ where: { slotId: slot.id } })).toBe(1);
  });

  it("the database alone resolves the race: overlapping transactions that skip every application check", async () => {
    // Transaction 1 inserts an active booking and holds its transaction open.
    // Transaction 2 then inserts for the same slot *before* T1 commits. Neither
    // runs the app's pre-check, so only the partial unique index can stop T2.
    const [a, b] = [await createUser(), await createUser()];
    const svc = await createService();
    const slot = await createSlot(svc.id, 120);
    const [db1, db2] = [freshClient(), freshClient()];

    let releaseT1!: () => void;
    const t1Holding = new Promise<void>((resolve) => (releaseT1 = resolve));
    let t1Inserted!: () => void;
    const t1HasInserted = new Promise<void>((resolve) => (t1Inserted = resolve));

    const t1 = db1.$transaction(
      async (tx) => {
        await tx.$executeRaw`INSERT INTO bookings (id, public_reference, slot_id, customer_id, status, price_cents, currency, updated_at)
                             VALUES ('race-1', 'SLT-RACE01', ${slot.id}, ${a.id}, 'CONFIRMED', 100, 'INR', now())`;
        t1Inserted();
        await t1Holding; // keep the transaction (and its uncommitted index entry) open
      },
      { timeout: 30_000 },
    );

    await t1HasInserted;
    const t2 = db2.$transaction(
      async (tx) =>
        tx.$executeRaw`INSERT INTO bookings (id, public_reference, slot_id, customer_id, status, price_cents, currency, updated_at)
                       VALUES ('race-2', 'SLT-RACE02', ${slot.id}, ${b.id}, 'CONFIRMED', 100, 'INR', now())`,
      { timeout: 30_000 },
    );

    // T2 is now blocked on T1's uncommitted unique-index entry. Let T1 commit.
    await new Promise((r) => setTimeout(r, 750));
    releaseT1();

    await expect(t1).resolves.toBeUndefined();
    await expect(t2).rejects.toThrow(/unique_active_booking_per_slot|23505|Unique constraint/i);
    expect(await prisma.booking.count({ where: { slotId: slot.id } })).toBe(1);
  });

  it("after a cancellation the slot can be won again — still by exactly one of several racers", async () => {
    const [first, ...racers] = await Promise.all(Array.from({ length: 4 }, (_, i) => createUser("CUSTOMER", `U${i}`)));
    const svc = await createService();
    const slot = await createSlot(svc.id, 100);
    const original = await createBooking(first, { slotId: slot.id });
    await prisma.booking.update({ where: { id: original.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });

    const dbs = racers.map(() => freshClient());
    const results = await Promise.allSettled(racers.map((u, i) => createBooking(u, { slotId: slot.id }, dbs[i])));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await activeBookings(slot.id)).toBe(1);
    expect(await prisma.booking.count({ where: { slotId: slot.id } })).toBe(2); // the cancelled one + the new winner
  });
});
