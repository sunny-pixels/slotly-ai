import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, Clock3, Hash, ReceiptText } from "lucide-react";
import { getPageUser } from "@/server/page-guards";
import { SignInPrompt } from "@/components/shell/account-picker";
import { getBookingForActor } from "@/server/services/bookings";
import { NotFoundError } from "@/server/errors";
import { getConfig } from "@/lib/config";
import { formatDuration, formatPrice } from "@/lib/money";
import { formatInZone, zoneLabel } from "@/lib/time";
import { idSchema } from "@/lib/validators";
import { PageBody, PageHeader } from "@/components/common/page";
import { BookingStatusBadge, Notice } from "@/components/common/status";
import { DetailList } from "@/components/ui/data";
import { buttonVariants } from "@/components/ui/button";
import { CancelBookingButton } from "@/components/booking/cancel-booking-button";

export const metadata = { title: "Booking details" };

type Params = Promise<{ id: string }>;

export default async function BookingDetailPage({ params }: { params: Params }) {
  const { id } = await params;
  const user = await getPageUser();
  if (!user) {
    return (
      <PageBody>
        <PageHeader breadcrumbs={[{ label: "My bookings", href: "/bookings" }, { label: "Booking" }]} title="Booking details" />
        <div className="max-w-[34rem]">
          <SignInPrompt description="Bookings are private. Choose the account that made this booking." />
        </div>
      </PageBody>
    );
  }
  if (!idSchema.safeParse(id).success) notFound();

  // Ownership is enforced by the query itself: another customer's booking is "not found".
  let booking;
  try {
    booking = await getBookingForActor(user, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const { BUSINESS_TIMEZONE: tz, CANCELLATION_CUTOFF_HOURS } = getConfig();
  const isActive = booking.status === "CONFIRMED" || booking.status === "PENDING";

  return (
    <PageBody>
      <PageHeader
        breadcrumbs={[{ label: "My bookings", href: "/bookings" }, { label: booking.publicReference }]}
        eyebrow={<span className="font-mono normal-case tracking-normal">{booking.publicReference}</span>}
        title={booking.service.name}
        description={formatInZone(booking.slot.startAt, "EEEE d MMMM yyyy 'at' HH:mm", tz)}
        actions={
          <>
            <BookingStatusBadge status={booking.status} />
            {booking.cancellation.allowed && (
              <CancelBookingButton
                booking={{ id: booking.id, publicReference: booking.publicReference, serviceName: booking.service.name, startAt: booking.slot.startAt }}
                timeZone={tz}
                size="md"
                label="Cancel booking"
              />
            )}
          </>
        }
      />

      <div className="grid gap-(--section-gap) xl:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
        <section aria-labelledby="details-heading" className="flex flex-col gap-5">
          <h2 id="details-heading" className="text-section font-semibold">
            Appointment
          </h2>
          <div className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 2xl:grid-cols-4">
            {[
              { icon: CalendarDays, label: "Date", value: formatInZone(booking.slot.startAt, "EEE d MMM yyyy", tz) },
              {
                icon: Clock3,
                label: "Time",
                value: `${formatInZone(booking.slot.startAt, "HH:mm", tz)}–${formatInZone(booking.slot.endAt, "HH:mm", tz)} ${zoneLabel(booking.slot.startAt, tz)}`,
              },
              { icon: ReceiptText, label: "Price", value: formatPrice(booking.priceCents, booking.currency) },
              { icon: Hash, label: "Reference", value: booking.publicReference },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="bg-surface px-5 py-4">
                <p className="flex items-center gap-1.5 text-meta text-ink-muted">
                  <Icon className="size-3.5" aria-hidden /> {label}
                </p>
                <p className="mt-1 font-display text-card-title font-semibold tabular">{value}</p>
              </div>
            ))}
          </div>

          <DetailList
            className="rounded-lg border border-line bg-surface p-5"
            items={[
              { label: "Service", value: booking.service.name },
              { label: "Duration", value: formatDuration(booking.service.durationMinutes) },
              { label: "Status", value: <BookingStatusBadge status={booking.status} /> },
              { label: "Booked on", value: formatInZone(booking.createdAt, "d MMM yyyy, HH:mm", tz) },
              ...(booking.cancelledAt ? [{ label: "Cancelled on", value: formatInZone(booking.cancelledAt, "d MMM yyyy, HH:mm", tz) }] : []),
              ...(booking.notes ? [{ label: "Your notes", value: <span className="whitespace-pre-wrap font-normal">{booking.notes}</span> }] : []),
            ]}
          />
        </section>

        <aside aria-labelledby="policy-heading" className="flex flex-col gap-4">
          <h2 id="policy-heading" className="text-section font-semibold">
            Cancellation policy
          </h2>
          <div className="space-y-3 rounded-lg bg-canvas-sunken/70 p-5 text-[0.875rem] text-ink-muted">
            <p>
              Cancel free of charge up to <strong className="text-ink">{CANCELLATION_CUTOFF_HOURS} hours</strong> before the start time. After that,
              contact the studio — late cancellations are charged 50% of the price.
            </p>
            <p>To reschedule, cancel this booking and choose a new time.</p>
          </div>
          {isActive && !booking.cancellation.allowed && booking.cancellation.reason && (
            <Notice tone="warning" title="Online cancellation unavailable">
              {booking.cancellation.reason}
            </Notice>
          )}
          {booking.status === "CANCELLED" && (
            <Notice tone="info" title="This booking is cancelled">
              The time was released for other customers.{" "}
              <Link href={`/services/${booking.service.slug}/book`} className="font-medium underline underline-offset-4">
                Book {booking.service.name} again
              </Link>
            </Notice>
          )}
          <Link href="/bookings" className={buttonVariants({ variant: "secondary" })}>
            Back to my bookings
          </Link>
        </aside>
      </div>
    </PageBody>
  );
}
