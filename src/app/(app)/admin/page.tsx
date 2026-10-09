import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarClock } from "lucide-react";
import { getAdminOverview } from "@/server/services/dashboard";
import { formatPrice } from "@/lib/money";
import { formatInZone, todayKey } from "@/lib/time";
import { EmptyState, PageBody, PageHeader, SectionHeader } from "@/components/common/page";
import { BookingStatusBadge } from "@/components/common/status";
import { Table, TableFrame, TD, TH, THead, TR } from "@/components/ui/data";
import { buttonVariants } from "@/components/ui/button";

export const metadata = { title: "Admin overview" };

export default async function AdminOverviewPage() {
  const data = await getAdminOverview();
  const tz = data.timeZone;
  const m = data.metrics;

  const metrics = [
    { label: "Upcoming bookings", value: m.upcomingBookings, href: "/admin/bookings?status=CONFIRMED" },
    { label: "Today", value: m.bookingsToday, hint: "active bookings" },
    { label: "Open slots", value: m.openSlotsWeek, hint: "next 7 days", href: "/admin/availability" },
    { label: "Active services", value: m.activeServices, hint: m.inactiveServices ? `${m.inactiveServices} inactive` : undefined, href: "/admin/services" },
    { label: "New bookings", value: m.newBookingsWeek, hint: "last 7 days" },
    { label: "Cancellations", value: m.cancellationsWeek, hint: "last 7 days", href: "/admin/bookings?status=CANCELLED" },
  ];

  const pendingItems = [
    data.pending.pastUncompleted > 0 && {
      text: `${data.pending.pastUncompleted} past appointment${data.pending.pastUncompleted === 1 ? "" : "s"} still marked as confirmed`,
      href: `/admin/bookings?status=CONFIRMED&to=${todayKey(tz)}`,
      action: "Review",
    },
    data.pending.failedDocs > 0 && {
      text: `${data.pending.failedDocs} knowledge document${data.pending.failedDocs === 1 ? "" : "s"} failed to ingest`,
      href: "/admin/knowledge-base",
      action: "Fix",
    },
  ].filter(Boolean) as { text: string; href: string; action: string }[];

  return (
    <PageBody>
      <PageHeader
        eyebrow="Studio admin"
        title="Overview"
        description={`Live figures from the booking database · ${formatInZone(new Date(), "EEEE d MMMM yyyy", tz)}`}
        actions={
          <Link href="/admin/availability" className={buttonVariants({ variant: "secondary" })}>
            <CalendarClock /> Manage availability
          </Link>
        }
      />

      {/* Compact metric strip — every figure is a direct count */}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3 2xl:grid-cols-6">
        {metrics.map((x) => {
          const body = (
            <>
              <dt className="text-meta text-ink-muted">{x.label}</dt>
              <dd className="mt-1 flex items-baseline gap-2">
                <span className="font-display text-[1.75rem] font-bold leading-none tabular">{x.value}</span>
                {x.hint && <span className="text-[0.75rem] text-ink-subtle">{x.hint}</span>}
              </dd>
            </>
          );
          return x.href ? (
            <Link key={x.label} href={x.href} className="block bg-surface px-5 py-4 transition-colors hover:bg-surface-muted">
              {body}
            </Link>
          ) : (
            <div key={x.label} className="bg-surface px-5 py-4">
              {body}
            </div>
          );
        })}
      </dl>

      {pendingItems.length > 0 && (
        <ul className="flex flex-col gap-2">
          {pendingItems.map((p) => (
            <li key={p.text} className="flex items-center gap-3 rounded-md bg-warning-bg px-4 py-2.5 text-[0.875rem] text-warning">
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
              <span className="flex-1">{p.text}</span>
              <Link href={p.href} className="font-semibold underline-offset-4 hover:underline">
                {p.action}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-(--section-gap) 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <section aria-labelledby="agenda" className="flex flex-col gap-4">
          <SectionHeader id="agenda" title="Today’s agenda" description={`${data.todaysAgenda.length} appointment${data.todaysAgenda.length === 1 ? "" : "s"}`} />
          {data.todaysAgenda.length === 0 ? (
            <EmptyState title="Nothing booked today" description="Upcoming appointments for today will appear here." />
          ) : (
            <ol className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
              {data.todaysAgenda.map((b) => (
                <li key={b.id} className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-4 px-5 py-3">
                  <span className="font-display font-bold tabular">{formatInZone(b.slot.startAt, "HH:mm", tz)}</span>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{b.slot.service.name}</p>
                    <p className="truncate text-meta text-ink-muted">
                      {b.customer.name} · <span className="font-mono">{b.publicReference}</span>
                    </p>
                  </div>
                  <BookingStatusBadge status={b.status} />
                </li>
              ))}
            </ol>
          )}
        </section>

        <section aria-labelledby="recent" className="flex flex-col gap-4">
          <SectionHeader
            id="recent"
            title="Recent booking activity"
            actions={
              <Link href="/admin/bookings" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                All bookings <ArrowRight />
              </Link>
            }
          />
          {data.recent.length === 0 ? (
            <EmptyState title="No bookings yet" />
          ) : (
            <TableFrame>
              <Table>
                <THead>
                  <tr>
                    <TH>Reference</TH>
                    <TH>Customer</TH>
                    <TH>Service · appointment</TH>
                    <TH>Price</TH>
                    <TH>Status</TH>
                  </tr>
                </THead>
                <tbody>
                  {data.recent.map((b) => (
                    <TR key={b.id}>
                      <TD className="font-mono text-meta">{b.publicReference}</TD>
                      <TD className="whitespace-nowrap">{b.customer.name}</TD>
                      <TD>
                        <p className="font-medium">{b.slot.service.name}</p>
                        <p className="text-meta text-ink-muted tabular">{formatInZone(b.slot.startAt, "EEE d MMM, HH:mm", tz)}</p>
                      </TD>
                      <TD className="tabular">{formatPrice(b.priceCents, b.currency)}</TD>
                      <TD>
                        <BookingStatusBadge status={b.status} />
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableFrame>
          )}
        </section>
      </div>
    </PageBody>
  );
}
