import { prisma } from "../db";
import { getConfig } from "@/lib/config";
import { ACTIVE_BOOKING_STATUSES } from "@/lib/booking-rules";
import { dayRange, todayKey } from "@/lib/time";

/** Admin overview — every number is a direct database count, nothing is estimated. */
export async function getAdminOverview(now = new Date()) {
  const { BUSINESS_TIMEZONE: tz, BOOKING_MIN_LEAD_MINUTES } = getConfig();
  const today = dayRange(todayKey(tz, now), tz);
  const weekAhead = new Date(now.getTime() + 7 * 86_400_000);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const active = { in: [...ACTIVE_BOOKING_STATUSES] };

  const [upcomingBookings, activeServices, inactiveServices, openSlotsWeek, bookingsToday, newBookingsWeek, cancellationsWeek, pastUncompleted, failedDocs, todaysAgenda] =
    await Promise.all([
      prisma.booking.count({ where: { status: active, slot: { startAt: { gte: now } } } }),
      prisma.service.count({ where: { isActive: true } }),
      prisma.service.count({ where: { isActive: false } }),
      prisma.slot.count({
        where: {
          status: "AVAILABLE",
          service: { isActive: true },
          startAt: { gte: new Date(now.getTime() + BOOKING_MIN_LEAD_MINUTES * 60_000), lt: weekAhead },
          bookings: { none: { status: active } },
        },
      }),
      prisma.booking.count({ where: { status: active, slot: { startAt: { gte: today.start, lt: today.end } } } }),
      prisma.booking.count({ where: { createdAt: { gte: weekAgo } } }),
      prisma.booking.count({ where: { status: "CANCELLED", cancelledAt: { gte: weekAgo } } }),
      prisma.booking.count({ where: { status: active, slot: { endAt: { lt: now } } } }),
      prisma.knowledgeDocument.count({ where: { status: "FAILED" } }),
      prisma.booking.findMany({
        where: { status: active, slot: { startAt: { gte: today.start, lt: today.end } } },
        orderBy: { slot: { startAt: "asc" } },
        take: 20,
        select: {
          id: true,
          publicReference: true,
          status: true,
          customer: { select: { name: true } },
          slot: { select: { startAt: true, endAt: true, service: { select: { name: true } } } },
        },
      }),
    ]);

  const recent = await prisma.booking.findMany({
    orderBy: { createdAt: "desc" },
    take: 8,
    select: {
      id: true,
      publicReference: true,
      status: true,
      createdAt: true,
      priceCents: true,
      currency: true,
      customer: { select: { name: true } },
      slot: { select: { startAt: true, service: { select: { name: true } } } },
    },
  });

  return {
    timeZone: tz,
    metrics: {
      upcomingBookings,
      activeServices,
      inactiveServices,
      openSlotsWeek,
      bookingsToday,
      newBookingsWeek,
      cancellationsWeek,
    },
    pending: { pastUncompleted, failedDocs },
    todaysAgenda,
    recent,
  };
}
