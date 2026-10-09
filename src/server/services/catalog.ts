import { prisma } from "../db";
import { BusinessRuleError, NotFoundError } from "../errors";
import { getConfig } from "@/lib/config";
import { ACTIVE_BOOKING_STATUSES } from "@/lib/booking-rules";
import type { Prisma } from "@/generated/prisma/client";

export type ServiceView = {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  durationMinutes: number;
  priceCents: number;
  currency: string;
  isActive: boolean;
  /** Earliest bookable start time (ISO), straight from the slots table. */
  nextAvailableAt: string | null;
};

const serviceSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  category: true,
  durationMinutes: true,
  priceCents: true,
  currency: true,
  isActive: true,
} satisfies Prisma.ServiceSelect;

export type ServiceFilters = {
  q?: string;
  category?: string;
  maxPrice?: number; // whole currency units
  maxDuration?: number;
  includeInactive?: boolean;
  page?: number;
  pageSize?: number;
};

function buildWhere(filters: ServiceFilters): Prisma.ServiceWhereInput {
  const where: Prisma.ServiceWhereInput = {};
  if (!filters.includeInactive) where.isActive = true;
  if (filters.category) where.category = { equals: filters.category, mode: "insensitive" };
  if (filters.maxPrice !== undefined) where.priceCents = { lte: filters.maxPrice * 100 };
  if (filters.maxDuration !== undefined) where.durationMinutes = { lte: filters.maxDuration };
  if (filters.q) {
    const terms = filters.q.split(/\s+/).filter(Boolean).slice(0, 5);
    where.AND = terms.map((term) => ({
      OR: [
        { name: { contains: term, mode: "insensitive" } },
        { description: { contains: term, mode: "insensitive" } },
        { category: { contains: term, mode: "insensitive" } },
      ],
    }));
  }
  return where;
}

export async function listServices(filters: ServiceFilters = {}, now = new Date()) {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 50;
  const where = buildWhere(filters);
  const [rows, total] = await Promise.all([
    prisma.service.findMany({
      where,
      select: serviceSelect,
      orderBy: [{ category: "asc" }, { name: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.service.count({ where }),
  ]);
  const next = await nextAvailableByService(
    rows.map((r) => r.id),
    now,
  );
  const items: ServiceView[] = rows.map((r) => ({ ...r, nextAvailableAt: next.get(r.id)?.toISOString() ?? null }));
  return { items, total, page, pageSize };
}

export async function listCategories(): Promise<string[]> {
  const rows = await prisma.service.findMany({
    where: { isActive: true },
    distinct: ["category"],
    select: { category: true },
    orderBy: { category: "asc" },
  });
  return rows.map((r) => r.category);
}

export async function getService(idOrSlug: string, opts: { includeInactive?: boolean } = {}, now = new Date()) {
  const row = await prisma.service.findFirst({
    where: {
      OR: [{ id: idOrSlug }, { slug: idOrSlug }],
      ...(opts.includeInactive ? {} : { isActive: true }),
    },
    select: serviceSelect,
  });
  if (!row) throw new NotFoundError("Service not found.");
  const next = await nextAvailableByService([row.id], now);
  return { ...row, nextAvailableAt: next.get(row.id)?.toISOString() ?? null } satisfies ServiceView;
}

/** One query (DISTINCT ON) — no N+1 — for the earliest bookable slot of each service. */
export async function nextAvailableByService(serviceIds: string[], now = new Date()): Promise<Map<string, Date>> {
  if (serviceIds.length === 0) return new Map();
  const { BOOKING_MIN_LEAD_MINUTES } = getConfig();
  const earliest = new Date(now.getTime() + BOOKING_MIN_LEAD_MINUTES * 60_000);
  const rows = await prisma.$queryRaw<{ service_id: string; start_at: Date }[]>`
    SELECT DISTINCT ON (s.service_id) s.service_id, s.start_at
    FROM slots s
    WHERE s.service_id = ANY(${serviceIds}::text[])
      AND s.status = 'AVAILABLE'
      AND s.start_at >= ${earliest}
      AND NOT EXISTS (
        SELECT 1 FROM bookings b
        WHERE b.slot_id = s.id AND b.status IN ('PENDING', 'CONFIRMED')
      )
    ORDER BY s.service_id, s.start_at`;
  return new Map(rows.map((r) => [r.service_id, r.start_at]));
}

// ── Administration ───────────────────────────────────────────────────────────

function slugify(name: string) {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .slice(0, 60);
}

export async function createService(input: {
  name: string;
  description: string;
  category: string;
  durationMinutes: number;
  priceCents: number;
  currency: string;
  isActive: boolean;
}) {
  const base = slugify(input.name) || "service";
  let slug = base;
  for (let i = 2; await prisma.service.findUnique({ where: { slug }, select: { id: true } }); i++) {
    slug = `${base}-${i}`;
  }
  return prisma.service.create({ data: { ...input, slug }, select: serviceSelect });
}

/**
 * Updates a service without silently invalidating existing bookings:
 * - price changes apply to new bookings only (bookings store a price snapshot);
 * - deactivation stops new bookings but keeps existing ones intact;
 * - a duration change is refused while future active bookings exist, and
 *   otherwise retires future unbooked slots (which were cut for the old length).
 */
export async function updateService(
  id: string,
  patch: Partial<{
    name: string;
    description: string;
    category: string;
    durationMinutes: number;
    priceCents: number;
    currency: string;
    isActive: boolean;
  }>,
  now = new Date(),
) {
  const current = await prisma.service.findUnique({ where: { id }, select: serviceSelect });
  if (!current) throw new NotFoundError("Service not found.");

  let retiredSlots = 0;
  const durationChanged = patch.durationMinutes !== undefined && patch.durationMinutes !== current.durationMinutes;
  if (durationChanged) {
    const activeFuture = await prisma.booking.count({
      where: { status: { in: [...ACTIVE_BOOKING_STATUSES] }, slot: { serviceId: id, startAt: { gte: now } } },
    });
    if (activeFuture > 0) {
      throw new BusinessRuleError(
        `The duration can't change while ${activeFuture} upcoming booking${activeFuture === 1 ? "" : "s"} exist. Cancel or complete them first, or create a new service.`,
        "SERVICE_HAS_BOOKINGS",
      );
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const service = await tx.service.update({ where: { id }, data: patch, select: serviceSelect });
    if (durationChanged) {
      // Slots that never had a booking can be removed; slots with only cancelled history are blocked
      // (bookings reference them, so they are kept for the audit trail).
      const removed = await tx.slot.deleteMany({ where: { serviceId: id, startAt: { gte: now }, bookings: { none: {} } } });
      const blocked = await tx.slot.updateMany({
        where: { serviceId: id, startAt: { gte: now }, status: "AVAILABLE" },
        data: { status: "BLOCKED" },
      });
      retiredSlots = removed.count + blocked.count;
    }
    return service;
  });
  return { service: updated, retiredSlots };
}

export async function listServicesForAdmin(now = new Date()) {
  const [services, slotCounts, bookingCounts] = await Promise.all([
    prisma.service.findMany({ select: serviceSelect, orderBy: [{ isActive: "desc" }, { name: "asc" }] }),
    prisma.slot.groupBy({
      by: ["serviceId"],
      where: { startAt: { gte: now }, status: "AVAILABLE", bookings: { none: { status: { in: [...ACTIVE_BOOKING_STATUSES] } } } },
      _count: { _all: true },
    }),
    prisma.$queryRaw<{ service_id: string; upcoming: bigint }[]>`
      SELECT s.service_id, COUNT(*)::bigint AS upcoming
      FROM bookings b JOIN slots s ON s.id = b.slot_id
      WHERE b.status IN ('PENDING', 'CONFIRMED') AND s.start_at >= ${now}
      GROUP BY s.service_id`,
  ]);
  const open = new Map(slotCounts.map((c) => [c.serviceId, c._count._all]));
  const upcoming = new Map(bookingCounts.map((c) => [c.service_id, Number(c.upcoming)]));
  return services.map((s) => ({ ...s, openSlots: open.get(s.id) ?? 0, upcomingBookings: upcoming.get(s.id) ?? 0 }));
}
