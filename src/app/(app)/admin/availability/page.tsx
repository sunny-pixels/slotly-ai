import { prisma } from "@/server/db";
import { listRules, listSlotsForAdmin } from "@/server/services/scheduling";
import { getConfig } from "@/lib/config";
import { addDaysToKey, isDateKey, todayKey } from "@/lib/time";
import { EmptyState, PageBody, PageHeader } from "@/components/common/page";
import { AvailabilityAdmin } from "@/components/admin/availability-admin";

export const metadata = { title: "Availability" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminAvailabilityPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { BUSINESS_TIMEZONE: tz } = getConfig();
  const today = todayKey(tz);
  const services = await prisma.service.findMany({
    select: { id: true, name: true, durationMinutes: true, isActive: true },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
  if (services.length === 0) {
    return (
      <PageBody>
        <PageHeader title="Availability" />
        <EmptyState title="No services yet" description="Create a service first, then add its opening hours here." />
      </PageBody>
    );
  }
  const service = services.find((s) => s.id === sp.serviceId) ?? services[0];
  const from = typeof sp.from === "string" && isDateKey(sp.from) ? sp.from : today;
  const [rules, slots] = await Promise.all([listRules(service.id), listSlotsForAdmin(service.id, from, 7)]);

  return (
    <PageBody>
      <PageHeader
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Availability" }]}
        title="Availability"
        description={`Weekly opening hours generate bookable slots. Each service is an exclusive resource: slots never overlap, and a slot holds one active booking. Times in ${tz}.`}
      />
      <AvailabilityAdmin
        services={services}
        service={service}
        rules={rules.map((r) => ({
          id: r.id,
          weekday: r.weekday,
          openTime: r.openTime,
          closeTime: r.closeTime,
          slotIntervalMinutes: r.slotIntervalMinutes,
          effectiveFrom: r.effectiveFrom?.toISOString().slice(0, 10) ?? null,
          effectiveTo: r.effectiveTo?.toISOString().slice(0, 10) ?? null,
        }))}
        slots={slots}
        from={from}
        today={today}
        prevWeek={addDaysToKey(from, -7, tz)}
        nextWeek={addDaysToKey(from, 7, tz)}
        days={Array.from({ length: 7 }, (_, i) => addDaysToKey(from, i, tz))}
        timeZone={tz}
      />
    </PageBody>
  );
}
