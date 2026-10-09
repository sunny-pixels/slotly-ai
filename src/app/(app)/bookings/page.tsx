import Link from "next/link";
import { CalendarPlus, CalendarX2, Search } from "lucide-react";
import { getPageUser } from "@/server/page-guards";
import { SignInPrompt } from "@/components/shell/account-picker";
import { countCustomerBookings, listCustomerBookings, type BookingView } from "@/server/services/bookings";
import { getConfig } from "@/lib/config";
import { formatDuration, formatPrice } from "@/lib/money";
import { formatInZone } from "@/lib/time";
import { bookingListQuerySchema } from "@/lib/validators";
import { cn } from "@/lib/utils";
import { EmptyState, PageBody, PageHeader } from "@/components/common/page";
import { BookingStatusBadge } from "@/components/common/status";
import { Pagination } from "@/components/common/pagination";
import { Table, TableFrame, TD, TH, THead, TR } from "@/components/ui/data";
import { Input } from "@/components/ui/field";
import { Button, buttonVariants } from "@/components/ui/button";
import { CancelBookingButton } from "@/components/booking/cancel-booking-button";

export const metadata = { title: "My bookings" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const VIEWS = [
  { key: "upcoming", label: "Upcoming" },
  { key: "past", label: "Past" },
  { key: "cancelled", label: "Cancelled" },
] as const;

export default async function MyBookingsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const user = await getPageUser();
  if (!user) {
    return (
      <PageBody>
        <PageHeader title="My bookings" description="Choose an account to see its reservations." />
        <div className="max-w-[34rem]">
          <SignInPrompt callbackUrl="/bookings" />
        </div>
      </PageBody>
    );
  }
  const parsed = bookingListQuerySchema.safeParse({
    view: typeof sp.view === "string" ? sp.view : undefined,
    q: typeof sp.q === "string" && sp.q ? sp.q : undefined,
    page: typeof sp.page === "string" ? sp.page : undefined,
    pageSize: 10,
  });
  const query = parsed.success ? parsed.data : bookingListQuerySchema.parse({ pageSize: 10 });
  const { BUSINESS_TIMEZONE: tz } = getConfig();
  const [result, counts] = await Promise.all([listCustomerBookings(user, query), countCustomerBookings(user)]);

  const href = (patch: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    const merged = { view: query.view, q: query.q, page: undefined as number | undefined, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v !== undefined && v !== "" && !(k === "view" && v === "upcoming") && !(k === "page" && v === 1)) p.set(k, String(v));
    const s = p.toString();
    return s ? `/bookings?${s}` : "/bookings";
  };

  return (
    <PageBody>
      <PageHeader
        title="My bookings"
        description="Your reservations, newest first. Cancel online up to 24 hours before an appointment."
        actions={
          <Link href="/" className={buttonVariants({ variant: "primary" })}>
            <CalendarPlus /> New booking
          </Link>
        }
      />

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <nav aria-label="Booking views" className="flex gap-1 border-b border-line md:border-0">
            {VIEWS.map((v) => {
              const active = query.view === v.key;
              return (
                <Link
                  key={v.key}
                  href={href({ view: v.key, page: undefined })}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "-mb-px flex items-center gap-2 border-b-2 px-3 pb-2.5 pt-1 text-[0.875rem] font-medium md:mb-0 md:rounded-md md:border-0 md:py-1.5",
                    active ? "border-brand text-ink md:bg-surface md:shadow-xs md:ring-1 md:ring-line" : "border-transparent text-ink-muted hover:text-ink",
                  )}
                >
                  {v.label}
                  <span className="rounded-sm bg-canvas-sunken px-1.5 text-[0.6875rem] tabular text-ink-muted">{counts[v.key]}</span>
                </Link>
              );
            })}
          </nav>
          <form method="get" action="/bookings" className="flex w-full gap-2 md:w-auto">
            {query.view !== "upcoming" && <input type="hidden" name="view" value={query.view} />}
            <label htmlFor="booking-search" className="sr-only">
              Search bookings
            </label>
            <Input id="booking-search" name="q" defaultValue={query.q ?? ""} placeholder="Reference or service" className="md:w-64" maxLength={100} />
            <Button type="submit" variant="secondary" aria-label="Search">
              <Search />
            </Button>
          </form>
        </div>

        {result.items.length === 0 ? (
          <EmptyState
            icon={CalendarX2}
            title={query.q ? "No bookings match your search" : query.view === "upcoming" ? "No upcoming bookings" : `No ${query.view} bookings`}
            description={query.view === "upcoming" ? "When you book a time it appears here, with options to view or cancel it." : undefined}
            action={
              query.q ? (
                <Link href={href({ q: undefined })} className={buttonVariants({ variant: "secondary" })}>
                  Clear search
                </Link>
              ) : query.view === "upcoming" ? (
                <Link href="/" className={buttonVariants({ variant: "primary" })}>
                  Browse services
                </Link>
              ) : undefined
            }
          />
        ) : (
          <>
            {/* Desktop table */}
            <TableFrame className="hidden md:block">
              <Table>
                <THead>
                  <tr>
                    <TH>Service</TH>
                    <TH>Date &amp; time</TH>
                    <TH>Reference</TH>
                    <TH>Price</TH>
                    <TH>Status</TH>
                    <TH className="text-right">
                      <span className="sr-only">Actions</span>
                    </TH>
                  </tr>
                </THead>
                <tbody>
                  {result.items.map((b) => (
                    <TR key={b.id}>
                      <TD>
                        <Link href={`/bookings/${b.id}`} className="font-semibold text-ink hover:text-brand hover:underline underline-offset-4">
                          {b.service.name}
                        </Link>
                        <p className="text-meta text-ink-muted">{formatDuration(b.service.durationMinutes)}</p>
                      </TD>
                      <TD className="whitespace-nowrap tabular">
                        {formatInZone(b.slot.startAt, "EEE d MMM yyyy", tz)}
                        <p className="text-meta text-ink-muted">
                          {formatInZone(b.slot.startAt, "HH:mm", tz)}–{formatInZone(b.slot.endAt, "HH:mm", tz)}
                        </p>
                      </TD>
                      <TD className="font-mono text-meta">{b.publicReference}</TD>
                      <TD className="tabular">{formatPrice(b.priceCents, b.currency)}</TD>
                      <TD>
                        <BookingStatusBadge status={b.status} />
                      </TD>
                      <TD className="text-right">
                        <RowActions booking={b} tz={tz} />
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableFrame>

            {/* Mobile list */}
            <ul className="flex flex-col gap-3 md:hidden">
              {result.items.map((b) => (
                <li key={b.id} className="rounded-lg border border-line bg-surface p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Link href={`/bookings/${b.id}`} className="font-semibold hover:text-brand">
                        {b.service.name}
                      </Link>
                      <p className="text-meta text-ink-muted tabular">{formatInZone(b.slot.startAt, "EEE d MMM, HH:mm", tz)}</p>
                    </div>
                    <BookingStatusBadge status={b.status} />
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3 text-meta text-ink-muted">
                    <span className="font-mono">{b.publicReference}</span>
                    <RowActions booking={b} tz={tz} />
                  </div>
                </li>
              ))}
            </ul>

            <Pagination page={result.page} pageSize={result.pageSize} total={result.total} hrefFor={(page) => href({ page })} />
          </>
        )}
      </div>
    </PageBody>
  );
}

function RowActions({ booking, tz }: { booking: BookingView; tz: string }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <Link href={`/bookings/${booking.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
        Details
      </Link>
      {booking.cancellation.allowed && (
        <CancelBookingButton
          booking={{ id: booking.id, publicReference: booking.publicReference, serviceName: booking.service.name, startAt: booking.slot.startAt }}
          timeZone={tz}
        />
      )}
    </div>
  );
}
