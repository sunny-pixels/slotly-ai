import { randomInt } from "node:crypto";
import { prisma, type Db } from "../db";
import type { Actor } from "../authz";
import { BusinessRuleError, ConflictError, NotFoundError, isUniqueViolation } from "../errors";
import { getConfig } from "@/lib/config";
import {
  ACTIVE_BOOKING_STATUSES,
  cancellationEligibility,
  generateBookingReference,
  type BookingStatusValue,
} from "@/lib/booking-rules";
import type { Prisma } from "@/generated/prisma/client";

const bookingSelect = {
  id: true,
  publicReference: true,
  status: true,
  priceCents: true,
  currency: true,
  notes: true,
  createdAt: true,
  cancelledAt: true,
  customerId: true,
  slot: {
    select: {
      id: true,
      startAt: true,
      endAt: true,
      service: { select: { id: true, name: true, slug: true, category: true, durationMinutes: true } },
    },
  },
  customer: { select: { id: true, name: true, email: true } },
} satisfies Prisma.BookingSelect;

type BookingRow = Prisma.BookingGetPayload<{ select: typeof bookingSelect }>;

export type BookingView = {
  id: string;
  publicReference: string;
  status: BookingStatusValue;
  priceCents: number;
  currency: string;
  notes: string | null;
  createdAt: string;
  cancelledAt: string | null;
  slot: { id: string; startAt: string; endAt: string };
  service: { id: string; name: string; slug: string; category: string; durationMinutes: number };
  /** Only populated for administrators. */
  customer?: { id: string; name: string; email: string };
  cancellation: { allowed: boolean; reason?: string };
};

export function toBookingView(row: BookingRow, actor: Pick<Actor, "role">, now = new Date()): BookingView {
  const { CANCELLATION_CUTOFF_HOURS } = getConfig();
  const eligibility = cancellationEligibility({
    status: row.status,
    startAt: row.slot.startAt,
    now,
    cutoffHours: CANCELLATION_CUTOFF_HOURS,
    actorIsAdmin: actor.role === "ADMIN",
  });
  return {
    id: row.id,
    publicReference: row.publicReference,
    status: row.status,
    priceCents: row.priceCents,
    currency: row.currency,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    slot: { id: row.slot.id, startAt: row.slot.startAt.toISOString(), endAt: row.slot.endAt.toISOString() },
    service: row.slot.service,
    ...(actor.role === "ADMIN" ? { customer: row.customer } : {}),
    cancellation: eligibility.ok ? { allowed: true } : { allowed: false, reason: eligibility.reason },
  };
}

type SlotForBooking = {
  id: string;
  status: "AVAILABLE" | "BLOCKED";
  start_at: Date;
  service_id: string;
  service_name: string;
  is_active: boolean;
  price_cents: number;
  currency: string;
};

/**
 * Creates a booking for the signed-in customer.
 *
 * Correctness under concurrency does NOT depend on the pre-checks below — they
 * only produce friendlier errors. Two transactions can both pass them; the
 * partial unique index `unique_active_booking_per_slot` then guarantees that
 * only one INSERT commits and the other fails with a unique violation (→ 409).
 */
export async function createBooking(
  actor: Actor,
  input: { slotId: string; notes?: string },
  db: Db = prisma,
  now: Date = new Date(),
): Promise<BookingView> {
  const { BOOKING_MIN_LEAD_MINUTES } = getConfig();

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(
        async (tx) => {
          // FOR SHARE: concurrent bookings don't block each other (the index arbitrates),
          // but an administrator blocking this slot (FOR UPDATE) is serialised against us.
          const rows = await tx.$queryRaw<SlotForBooking[]>`
            SELECT s.id, s.status, s.start_at, s.service_id, sv.name AS service_name,
                   sv.is_active, sv.price_cents, sv.currency
            FROM slots s
            JOIN services sv ON sv.id = s.service_id
            WHERE s.id = ${input.slotId}
            FOR SHARE OF s`;
          const slot = rows[0];
          if (!slot) throw new NotFoundError("That time slot does not exist.");
          if (!slot.is_active) {
            throw new BusinessRuleError("This service is not currently accepting bookings.", "SERVICE_INACTIVE");
          }
          if (slot.status === "BLOCKED") {
            throw new BusinessRuleError("This time slot is no longer offered.", "SLOT_BLOCKED");
          }
          if (slot.start_at.getTime() < now.getTime() + BOOKING_MIN_LEAD_MINUTES * 60_000) {
            throw new BusinessRuleError(
              slot.start_at.getTime() <= now.getTime()
                ? "This time slot is in the past."
                : `Online booking closes ${BOOKING_MIN_LEAD_MINUTES} minutes before the appointment.`,
              "SLOT_CLOSED",
            );
          }

          const existing = await tx.booking.findFirst({
            where: { slotId: slot.id, status: { in: [...ACTIVE_BOOKING_STATUSES] } },
            select: { id: true },
          });
          if (existing) throw slotTaken();

          const created = await tx.booking.create({
            data: {
              publicReference: generateBookingReference(randomInt),
              slotId: slot.id,
              customerId: actor.id,
              status: "CONFIRMED",
              priceCents: slot.price_cents,
              currency: slot.currency,
              notes: input.notes?.trim() || null,
            },
            select: bookingSelect,
          });
          return toBookingView(created, actor, now);
        },
        { maxWait: 10_000, timeout: 15_000 },
      );
    } catch (error) {
      if (isUniqueViolation(error, "slot")) throw slotTaken();
      // Extremely unlikely reference collision: retry with a fresh reference.
      if (isUniqueViolation(error, "public_reference") || isUniqueViolation(error, "publicReference")) continue;
      throw error;
    }
  }
  throw new ConflictError("Could not allocate a booking reference. Please try again.", "REFERENCE_COLLISION");
}

function slotTaken() {
  return new ConflictError(
    "Sorry — this time slot was just booked by someone else. Please choose another time.",
    "SLOT_TAKEN",
  );
}

type BookingLockRow = { id: string; customer_id: string; status: BookingStatusValue; start_at: Date };

/**
 * Cancels a booking as an authorised state transition. Customers can only
 * reach their own bookings (others are reported as "not found" so existence is
 * not leaked). Repeating a cancellation is a safe no-op.
 */
export async function cancelBooking(
  actor: Actor,
  bookingId: string,
  db: Db = prisma,
  now: Date = new Date(),
): Promise<{ booking: BookingView; alreadyCancelled: boolean }> {
  const { CANCELLATION_CUTOFF_HOURS } = getConfig();
  const admin = actor.role === "ADMIN";

  return db.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<BookingLockRow[]>`
        SELECT b.id, b.customer_id, b.status, s.start_at
        FROM bookings b
        JOIN slots s ON s.id = b.slot_id
        WHERE b.id = ${bookingId}
        FOR UPDATE OF b`;
      const row = rows[0];
      if (!row || (!admin && row.customer_id !== actor.id)) throw new NotFoundError("Booking not found.");

      if (row.status === "CANCELLED") {
        const current = await tx.booking.findUniqueOrThrow({ where: { id: row.id }, select: bookingSelect });
        return { booking: toBookingView(current, actor, now), alreadyCancelled: true };
      }

      const eligibility = cancellationEligibility({
        status: row.status,
        startAt: row.start_at,
        now,
        cutoffHours: CANCELLATION_CUTOFF_HOURS,
        actorIsAdmin: admin,
      });
      if (!eligibility.ok) throw new BusinessRuleError(eligibility.reason, eligibility.code);

      const result = await tx.booking.updateMany({
        where: {
          id: row.id,
          status: { in: [...ACTIVE_BOOKING_STATUSES] },
          ...(admin ? {} : { customerId: actor.id }),
        },
        data: { status: "CANCELLED", cancelledAt: now, cancelledById: actor.id },
      });
      if (result.count !== 1) throw new ConflictError("The booking changed while cancelling. Please refresh.");

      const updated = await tx.booking.findUniqueOrThrow({ where: { id: row.id }, select: bookingSelect });
      return { booking: toBookingView(updated, actor, now), alreadyCancelled: false };
    },
    { maxWait: 10_000, timeout: 15_000 },
  );
}

/** Marks a past, active booking as completed (administrators only — enforced by the caller). */
export async function completeBooking(actor: Actor, bookingId: string, now = new Date()): Promise<BookingView> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: bookingSelect });
  if (!booking) throw new NotFoundError("Booking not found.");
  if (booking.status !== "CONFIRMED" && booking.status !== "PENDING") {
    throw new BusinessRuleError("Only active bookings can be marked as completed.");
  }
  if (booking.slot.startAt.getTime() > now.getTime()) {
    throw new BusinessRuleError("An appointment can only be completed after it has started.");
  }
  const updated = await prisma.booking.update({
    where: { id: bookingId },
    data: { status: "COMPLETED" },
    select: bookingSelect,
  });
  return toBookingView(updated, actor, now);
}

/** Booking lookup that enforces ownership server-side. Accepts an id or public reference. */
export async function getBookingForActor(actor: Actor, idOrReference: string, now = new Date()): Promise<BookingView> {
  const booking = await prisma.booking.findFirst({
    where: {
      OR: [{ id: idOrReference }, { publicReference: idOrReference.toUpperCase() }],
      ...(actor.role === "ADMIN" ? {} : { customerId: actor.id }),
    },
    select: bookingSelect,
  });
  if (!booking) throw new NotFoundError("Booking not found.");
  return toBookingView(booking, actor, now);
}

export type Paginated<T> = { items: T[]; total: number; page: number; pageSize: number };

export type CustomerBookingView = "upcoming" | "past" | "cancelled" | "all";

export async function listCustomerBookings(
  actor: Actor,
  params: { view: CustomerBookingView; q?: string; page: number; pageSize: number },
  now = new Date(),
): Promise<Paginated<BookingView>> {
  const where: Prisma.BookingWhereInput = { customerId: actor.id };
  if (params.view === "upcoming") {
    where.status = { in: [...ACTIVE_BOOKING_STATUSES] };
    where.slot = { startAt: { gte: now } };
  } else if (params.view === "past") {
    where.OR = [
      { status: "COMPLETED" },
      { status: { in: [...ACTIVE_BOOKING_STATUSES] }, slot: { startAt: { lt: now } } },
    ];
  } else if (params.view === "cancelled") {
    where.status = "CANCELLED";
  }
  if (params.q) {
    where.AND = [
      {
        OR: [
          { publicReference: { contains: params.q, mode: "insensitive" } },
          { slot: { service: { name: { contains: params.q, mode: "insensitive" } } } },
        ],
      },
    ];
  }
  const orderBy: Prisma.BookingOrderByWithRelationInput =
    params.view === "upcoming" ? { slot: { startAt: "asc" } } : { slot: { startAt: "desc" } };

  const [rows, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      orderBy,
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      select: bookingSelect,
    }),
    prisma.booking.count({ where }),
  ]);
  return { items: rows.map((r) => toBookingView(r, actor, now)), total, page: params.page, pageSize: params.pageSize };
}

export async function countCustomerBookings(actor: Actor, now = new Date()) {
  const [upcoming, past, cancelled] = await Promise.all([
    prisma.booking.count({
      where: { customerId: actor.id, status: { in: [...ACTIVE_BOOKING_STATUSES] }, slot: { startAt: { gte: now } } },
    }),
    prisma.booking.count({
      where: {
        customerId: actor.id,
        OR: [{ status: "COMPLETED" }, { status: { in: [...ACTIVE_BOOKING_STATUSES] }, slot: { startAt: { lt: now } } }],
      },
    }),
    prisma.booking.count({ where: { customerId: actor.id, status: "CANCELLED" } }),
  ]);
  return { upcoming, past, cancelled };
}

export async function listAdminBookings(
  actor: Actor,
  params: {
    status?: BookingStatusValue;
    serviceId?: string;
    q?: string;
    from?: Date;
    to?: Date;
    page: number;
    pageSize: number;
  },
  now = new Date(),
): Promise<Paginated<BookingView>> {
  const where: Prisma.BookingWhereInput = {};
  if (params.status) where.status = params.status;
  const slotWhere: Prisma.SlotWhereInput = {};
  if (params.serviceId) slotWhere.serviceId = params.serviceId;
  if (params.from || params.to) slotWhere.startAt = { ...(params.from && { gte: params.from }), ...(params.to && { lt: params.to }) };
  if (Object.keys(slotWhere).length) where.slot = slotWhere;
  if (params.q) {
    where.OR = [
      { publicReference: { contains: params.q, mode: "insensitive" } },
      { customer: { name: { contains: params.q, mode: "insensitive" } } },
      { customer: { email: { contains: params.q, mode: "insensitive" } } },
    ];
  }
  const [rows, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      orderBy: { slot: { startAt: "desc" } },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      select: bookingSelect,
    }),
    prisma.booking.count({ where }),
  ]);
  return { items: rows.map((r) => toBookingView(r, actor, now)), total, page: params.page, pageSize: params.pageSize };
}
