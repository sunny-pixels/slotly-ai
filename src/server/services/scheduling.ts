import { prisma } from "../db";
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from "../errors";
import { getConfig } from "@/lib/config";
import { ACTIVE_BOOKING_STATUSES } from "@/lib/booking-rules";
import { addDaysToKey, dayRange, weekdayOf, zonedTime } from "@/lib/time";

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
const toHHMM = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

// ── Availability rules (weekly opening hours) ────────────────────────────────

export async function listRules(serviceId?: string) {
  return prisma.availabilityRule.findMany({
    where: serviceId ? { serviceId } : {},
    orderBy: [{ serviceId: "asc" }, { weekday: "asc" }, { openTime: "asc" }],
    select: {
      id: true,
      serviceId: true,
      weekday: true,
      openTime: true,
      closeTime: true,
      slotIntervalMinutes: true,
      timezone: true,
      effectiveFrom: true,
      effectiveTo: true,
      service: { select: { name: true } },
    },
  });
}

export async function createRule(input: {
  serviceId: string;
  weekday: number;
  openTime: string;
  closeTime: string;
  slotIntervalMinutes: number;
  effectiveFrom?: string;
  effectiveTo?: string;
}) {
  const { BUSINESS_TIMEZONE } = getConfig();
  const service = await prisma.service.findUnique({ where: { id: input.serviceId }, select: { id: true, durationMinutes: true } });
  if (!service) throw new NotFoundError("Service not found.");
  if (toMinutes(input.closeTime) - toMinutes(input.openTime) < service.durationMinutes) {
    throw new BusinessRuleError("Opening hours are shorter than one appointment of this service.");
  }

  // Rules for the same service and weekday must not overlap.
  const sameDay = await prisma.availabilityRule.findMany({
    where: { serviceId: input.serviceId, weekday: input.weekday },
    select: { openTime: true, closeTime: true },
  });
  const clash = sameDay.find((r) => input.openTime < r.closeTime && r.openTime < input.closeTime);
  if (clash) {
    throw new ConflictError(`These hours overlap an existing rule (${clash.openTime}–${clash.closeTime}).`, "RULE_OVERLAP");
  }

  return prisma.availabilityRule.create({
    data: {
      serviceId: input.serviceId,
      weekday: input.weekday,
      openTime: input.openTime,
      closeTime: input.closeTime,
      slotIntervalMinutes: input.slotIntervalMinutes,
      timezone: BUSINESS_TIMEZONE,
      effectiveFrom: input.effectiveFrom ? new Date(`${input.effectiveFrom}T00:00:00Z`) : null,
      effectiveTo: input.effectiveTo ? new Date(`${input.effectiveTo}T00:00:00Z`) : null,
    },
  });
}

/** Removing a rule affects future slot generation only; existing slots and bookings are untouched. */
export async function deleteRule(id: string) {
  const res = await prisma.availabilityRule.deleteMany({ where: { id } });
  if (res.count === 0) throw new NotFoundError("Rule not found.");
}

// ── Slot generation ──────────────────────────────────────────────────────────

const MAX_GENERATION_DAYS = 62;

/**
 * Expands the service's weekly rules into concrete slots for [fromKey, toKey]
 * (business-local dates). Every generated slot lies entirely inside a rule's
 * opening hours. Inserts are idempotent: `createMany({ skipDuplicates })`
 * compiles to `ON CONFLICT DO NOTHING`, which also skips rows rejected by the
 * no-overlap exclusion constraint.
 */
export async function generateSlots(serviceId: string, fromKey: string, toKey: string, now = new Date()) {
  const { BUSINESS_TIMEZONE: tz } = getConfig();
  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { id: true, durationMinutes: true, isActive: true },
  });
  if (!service) throw new NotFoundError("Service not found.");
  if (!service.isActive) throw new BusinessRuleError("Activate the service before generating slots.");

  const days = Math.round((dayRange(toKey, tz).start.getTime() - dayRange(fromKey, tz).start.getTime()) / 86_400_000) + 1;
  if (days < 1) throw new ValidationError("'to' must be on or after 'from'.");
  if (days > MAX_GENERATION_DAYS) throw new ValidationError(`Generate at most ${MAX_GENERATION_DAYS} days at a time.`);

  const rules = await prisma.availabilityRule.findMany({ where: { serviceId } });
  if (rules.length === 0) throw new BusinessRuleError("Add opening hours for this service first.", "NO_RULES");

  const candidates = buildSlotCandidates({ rules, durationMinutes: service.durationMinutes, fromKey, days, tz, now });
  if (candidates.length === 0) return { created: 0, considered: 0 };

  const result = await prisma.slot.createMany({
    data: candidates.map((c) => ({ serviceId, startAt: c.startAt, endAt: c.endAt })),
    skipDuplicates: true,
  });
  return { created: result.count, considered: candidates.length };
}

type RuleLike = {
  weekday: number;
  openTime: string;
  closeTime: string;
  slotIntervalMinutes: number;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
};

/** Pure slot expansion — exported for unit tests. */
export function buildSlotCandidates(args: {
  rules: RuleLike[];
  durationMinutes: number;
  fromKey: string;
  days: number;
  tz: string;
  now: Date;
}) {
  const out: { startAt: Date; endAt: Date }[] = [];
  for (let i = 0; i < args.days; i++) {
    const dateKey = addDaysToKey(args.fromKey, i, args.tz);
    const weekday = weekdayOf(dateKey, args.tz);
    for (const rule of args.rules) {
      if (rule.weekday !== weekday) continue;
      const effFrom = rule.effectiveFrom?.toISOString().slice(0, 10);
      const effTo = rule.effectiveTo?.toISOString().slice(0, 10);
      if (effFrom && dateKey < effFrom) continue;
      if (effTo && dateKey > effTo) continue;
      const open = toMinutes(rule.openTime);
      const close = toMinutes(rule.closeTime);
      for (let t = open; t + args.durationMinutes <= close; t += rule.slotIntervalMinutes) {
        const startAt = zonedTime(dateKey, toHHMM(t), args.tz);
        if (startAt.getTime() <= args.now.getTime()) continue;
        out.push({ startAt, endAt: new Date(startAt.getTime() + args.durationMinutes * 60_000) });
      }
    }
  }
  return out;
}

// ── Slot inspection & blocking ───────────────────────────────────────────────

export async function listSlotsForAdmin(serviceId: string, fromKey: string, days: number) {
  const { BUSINESS_TIMEZONE: tz } = getConfig();
  const from = dayRange(fromKey, tz).start;
  const to = dayRange(addDaysToKey(fromKey, days - 1, tz), tz).end;
  const slots = await prisma.slot.findMany({
    where: { serviceId, startAt: { gte: from, lt: to } },
    orderBy: { startAt: "asc" },
    select: {
      id: true,
      startAt: true,
      endAt: true,
      status: true,
      bookings: {
        where: { status: { in: [...ACTIVE_BOOKING_STATUSES] } },
        select: { id: true, publicReference: true, customer: { select: { name: true } } },
        take: 1,
      },
    },
  });
  return slots.map((s) => ({
    id: s.id,
    startAt: s.startAt.toISOString(),
    endAt: s.endAt.toISOString(),
    status: s.status,
    booking: s.bookings[0]
      ? { id: s.bookings[0].id, reference: s.bookings[0].publicReference, customerName: s.bookings[0].customer.name }
      : null,
  }));
}

/**
 * Blocks or re-opens a slot. A slot with an active booking cannot be blocked.
 * `FOR UPDATE` serialises this against in-flight bookings (which hold
 * `FOR SHARE` on the slot), so a booking cannot slip in between check and update.
 */
export async function setSlotStatus(slotId: string, status: "AVAILABLE" | "BLOCKED") {
  return prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM slots WHERE id = ${slotId} FOR UPDATE`;
      if (!rows[0]) throw new NotFoundError("Slot not found.");
      if (status === "BLOCKED") {
        const active = await tx.booking.count({ where: { slotId, status: { in: [...ACTIVE_BOOKING_STATUSES] } } });
        if (active > 0) {
          throw new ConflictError("This slot has an active booking. Cancel the booking before blocking the slot.", "SLOT_HAS_BOOKING");
        }
      }
      return tx.slot.update({ where: { id: slotId }, data: { status }, select: { id: true, status: true } });
    },
    { maxWait: 10_000, timeout: 15_000 },
  );
}
