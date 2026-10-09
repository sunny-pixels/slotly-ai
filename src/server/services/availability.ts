import { prisma } from "../db";
import { NotFoundError, ValidationError } from "../errors";
import { getConfig } from "@/lib/config";
import { ACTIVE_BOOKING_STATUSES, slotState, type SlotState } from "@/lib/booking-rules";
import { addDaysToKey, dayRange, minutesOfDay, toDateKey } from "@/lib/time";

export type SlotView = { id: string; startAt: string; endAt: string; state: SlotState };

export type DayAvailability = {
  service: { id: string; name: string; durationMinutes: number; priceCents: number; currency: string };
  date: string;
  timeZone: string;
  slots: SlotView[];
};

/**
 * Live availability for one service on one business-local day. Every slot is
 * returned with its state so the UI can show booked / unavailable times, but
 * only `available` slots are selectable — and the server re-validates anyway.
 */
export async function getDayAvailability(serviceId: string, dateKey: string, now = new Date()): Promise<DayAvailability> {
  const { BUSINESS_TIMEZONE: tz, BOOKING_MIN_LEAD_MINUTES } = getConfig();
  const service = await prisma.service.findFirst({
    where: { OR: [{ id: serviceId }, { slug: serviceId }], isActive: true },
    select: { id: true, name: true, durationMinutes: true, priceCents: true, currency: true },
  });
  if (!service) throw new NotFoundError("Service not found.");

  const { start, end } = dayRange(dateKey, tz);
  const slots = await prisma.slot.findMany({
    where: { serviceId: service.id, startAt: { gte: start, lt: end } },
    orderBy: { startAt: "asc" },
    select: {
      id: true,
      startAt: true,
      endAt: true,
      status: true,
      bookings: { where: { status: { in: [...ACTIVE_BOOKING_STATUSES] } }, select: { id: true }, take: 1 },
    },
  });

  return {
    service,
    date: dateKey,
    timeZone: tz,
    slots: slots.map((s) => ({
      id: s.id,
      startAt: s.startAt.toISOString(),
      endAt: s.endAt.toISOString(),
      state: slotState({
        status: s.status,
        hasActiveBooking: s.bookings.length > 0,
        startAt: s.startAt,
        now,
        minLeadMinutes: BOOKING_MIN_LEAD_MINUTES,
      }),
    })),
  };
}

/** Number of bookable slots per business-local day, for the date strip. */
export async function getAvailabilityCalendar(serviceId: string, fromKey: string, days: number, now = new Date()) {
  if (days < 1 || days > 62) throw new ValidationError("A calendar range must be between 1 and 62 days.");
  const { BUSINESS_TIMEZONE: tz, BOOKING_MIN_LEAD_MINUTES } = getConfig();
  const from = dayRange(fromKey, tz).start;
  const to = dayRange(addDaysToKey(fromKey, days - 1, tz), tz).end;
  const earliest = new Date(Math.max(from.getTime(), now.getTime() + BOOKING_MIN_LEAD_MINUTES * 60_000));

  const slots = await prisma.slot.findMany({
    where: {
      serviceId,
      status: "AVAILABLE",
      startAt: { gte: earliest, lt: to },
      bookings: { none: { status: { in: [...ACTIVE_BOOKING_STATUSES] } } },
    },
    select: { startAt: true },
  });
  const counts = new Map<string, number>();
  for (const s of slots) {
    const key = toDateKey(s.startAt, tz);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from({ length: days }, (_, i) => {
    const date = addDaysToKey(fromKey, i, tz);
    return { date, available: counts.get(date) ?? 0 };
  });
}

export type OpenSlot = {
  id: string;
  startAt: string;
  endAt: string;
  service: { id: string; name: string; slug: string; priceCents: number; currency: string; durationMinutes: number };
};

/**
 * Bookable slots across a date range, optionally narrowed to one service and a
 * local time-of-day window. Used by the assistant's `get_available_slots` tool —
 * always a live database query, never vector search.
 */
export async function findOpenSlots(
  params: {
    serviceId?: string;
    fromKey: string;
    toKey: string;
    timeFromMinutes?: number;
    timeToMinutes?: number;
    limit?: number;
  },
  now = new Date(),
): Promise<OpenSlot[]> {
  const { BUSINESS_TIMEZONE: tz, BOOKING_MIN_LEAD_MINUTES } = getConfig();
  const from = dayRange(params.fromKey, tz).start;
  const to = dayRange(params.toKey, tz).end;
  const earliest = new Date(Math.max(from.getTime(), now.getTime() + BOOKING_MIN_LEAD_MINUTES * 60_000));
  const limit = Math.min(params.limit ?? 12, 50);

  const rows = await prisma.slot.findMany({
    where: {
      ...(params.serviceId ? { serviceId: params.serviceId } : {}),
      service: { isActive: true },
      status: "AVAILABLE",
      startAt: { gte: earliest, lt: to },
      bookings: { none: { status: { in: [...ACTIVE_BOOKING_STATUSES] } } },
    },
    orderBy: { startAt: "asc" },
    take: 400, // bounded; the time-of-day filter below is applied in memory
    select: {
      id: true,
      startAt: true,
      endAt: true,
      service: { select: { id: true, name: true, slug: true, priceCents: true, currency: true, durationMinutes: true } },
    },
  });

  return rows
    .filter((r) => {
      const m = minutesOfDay(r.startAt, tz);
      if (params.timeFromMinutes !== undefined && m < params.timeFromMinutes) return false;
      if (params.timeToMinutes !== undefined && m >= params.timeToMinutes) return false;
      return true;
    })
    .slice(0, limit)
    .map((r) => ({ id: r.id, startAt: r.startAt.toISOString(), endAt: r.endAt.toISOString(), service: r.service }));
}

/** Validates that a slot is currently bookable — used for the assistant's booking proposal card. */
export async function getBookableSlot(slotId: string, now = new Date()) {
  const { BOOKING_MIN_LEAD_MINUTES } = getConfig();
  const slot = await prisma.slot.findUnique({
    where: { id: slotId },
    select: {
      id: true,
      startAt: true,
      endAt: true,
      status: true,
      service: { select: { id: true, name: true, slug: true, priceCents: true, currency: true, durationMinutes: true, isActive: true } },
      bookings: { where: { status: { in: [...ACTIVE_BOOKING_STATUSES] } }, select: { id: true }, take: 1 },
    },
  });
  if (!slot || !slot.service.isActive) return null;
  const state = slotState({
    status: slot.status,
    hasActiveBooking: slot.bookings.length > 0,
    startAt: slot.startAt,
    now,
    minLeadMinutes: BOOKING_MIN_LEAD_MINUTES,
  });
  return state === "available" ? slot : null;
}
