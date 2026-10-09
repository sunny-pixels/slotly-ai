import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { getCurrentUser } from "@/server/authz";
import { prisma } from "@/server/db";
import { listAdminBookings } from "@/server/services/bookings";
import { getConfig } from "@/lib/config";
import { formatDuration, formatPrice } from "@/lib/money";
import { dayRange, formatInZone } from "@/lib/time";
import { adminBookingListQuerySchema } from "@/lib/validators";
import { EmptyState, PageBody, PageHeader } from "@/components/common/page";
import { BookingStatusBadge } from "@/components/common/status";
import { Pagination } from "@/components/common/pagination";
import { Table, TableFrame, TD, TH, THead, TR } from "@/components/ui/data";
import { Input, NativeSelect } from "@/components/ui/field";
import { Button, buttonVariants } from "@/components/ui/button";
import { AdminBookingActions } from "@/components/admin/booking-actions";

export const metadata = { title: "Bookings" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminBookingsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const actor = (await getCurrentUser())!; // the admin layout has already verified the role
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const parsed = adminBookingListQuerySchema.safeParse({
    status: str(sp.status),
    serviceId: str(sp.serviceId),
    q: str(sp.q),
    from: str(sp.from),
    to: str(sp.to),
    page: str(sp.page),
    pageSize: 15,
  });
  const q = parsed.success ? parsed.data : adminBookingListQuerySchema.parse({ pageSize: 15 });
  const { BUSINESS_TIMEZONE: tz } = getConfig();
  const now = new Date();

  const [result, services] = await Promise.all([
    listAdminBookings(actor, {
      ...q,
      from: q.from ? dayRange(q.from, tz).start : undefined,
      to: q.to ? dayRange(q.to, tz).end : undefined,
    }),
    prisma.service.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const filtering = Boolean(q.status || q.serviceId || q.q || q.from || q.to);
  const href = (page: number) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ status: q.status, serviceId: q.serviceId, q: q.q, from: q.from, to: q.to })) if (v) p.set(k, v);
    if (page > 1) p.set("page", String(page));
    const s = p.toString();
    return s ? `/admin/bookings?${s}` : "/admin/bookings";
  };

  return (
    <PageBody>
      <PageHeader
        breadcrumbs={[{ label: "Admin", href: "/admin" }, { label: "Bookings" }]}
        title="Bookings"
        description="Every reservation across all services. Administrators can cancel at any time and mark past appointments as completed."
      />

      <form method="get" className="grid gap-3 rounded-lg bg-canvas-sunken/70 p-3 sm:grid-cols-2 xl:grid-cols-[minmax(14rem,1.5fr)_repeat(4,minmax(9rem,1fr))_auto]">
        <div>
          <label htmlFor="f-q" className="sr-only">
            Search
          </label>
          <Input id="f-q" name="q" defaultValue={q.q ?? ""} placeholder="Reference, customer name or email" maxLength={100} />
        </div>
        <div>
          <label htmlFor="f-status" className="sr-only">
            Status
          </label>
          <NativeSelect id="f-status" name="status" defaultValue={q.status ?? ""}>
            <option value="">Any status</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="PENDING">Pending</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
          </NativeSelect>
        </div>
        <div>
          <label htmlFor="f-service" className="sr-only">
            Service
          </label>
          <NativeSelect id="f-service" name="serviceId" defaultValue={q.serviceId ?? ""}>
            <option value="">All services</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <label htmlFor="f-from" className="sr-only">
            Appointments from
          </label>
          <Input id="f-from" name="from" type="date" defaultValue={q.from ?? ""} title="Appointments from" />
        </div>
        <div>
          <label htmlFor="f-to" className="sr-only">
            Appointments to
          </label>
          <Input id="f-to" name="to" type="date" defaultValue={q.to ?? ""} title="Appointments to" />
        </div>
        <div className="flex gap-2">
          <Button type="submit" className="flex-1 xl:flex-none">
            Filter
          </Button>
          {filtering && (
            <Link href="/admin/bookings" className={buttonVariants({ variant: "ghost" })}>
              Reset
            </Link>
          )}
        </div>
      </form>

      {result.items.length === 0 ? (
        <EmptyState icon={ClipboardList} title={filtering ? "No bookings match these filters" : "No bookings yet"} />
      ) : (
        <div className="flex flex-col gap-4">
          <TableFrame>
            <Table>
              <THead>
                <tr>
                  <TH>Reference</TH>
                  <TH>Customer</TH>
                  <TH>Service</TH>
                  <TH>Appointment</TH>
                  <TH>Price</TH>
                  <TH>Status</TH>
                  <TH>Booked</TH>
                  <TH className="text-right">Actions</TH>
                </tr>
              </THead>
              <tbody>
                {result.items.map((b) => (
                  <TR key={b.id}>
                    <TD className="font-mono text-meta">{b.publicReference}</TD>
                    <TD>
                      <p className="font-medium">{b.customer?.name}</p>
                      <p className="text-meta text-ink-muted">{b.customer?.email}</p>
                    </TD>
                    <TD>
                      <p>{b.service.name}</p>
                      <p className="text-meta text-ink-muted">{formatDuration(b.service.durationMinutes)}</p>
                    </TD>
                    <TD className="whitespace-nowrap tabular">
                      {formatInZone(b.slot.startAt, "EEE d MMM yyyy", tz)}
                      <p className="text-meta text-ink-muted">{formatInZone(b.slot.startAt, "HH:mm", tz)}</p>
                    </TD>
                    <TD className="tabular">{formatPrice(b.priceCents, b.currency)}</TD>
                    <TD>
                      <BookingStatusBadge status={b.status} />
                    </TD>
                    <TD className="whitespace-nowrap text-meta text-ink-muted tabular">{formatInZone(b.createdAt, "d MMM, HH:mm", tz)}</TD>
                    <TD className="text-right">
                      <AdminBookingActions
                        booking={{ id: b.id, publicReference: b.publicReference, serviceName: b.service.name, startAt: b.slot.startAt, status: b.status }}
                        timeZone={tz}
                        canComplete={new Date(b.slot.startAt) <= now}
                      />
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableFrame>
          <Pagination page={result.page} pageSize={result.pageSize} total={result.total} hrefFor={href} />
        </div>
      )}
    </PageBody>
  );
}
