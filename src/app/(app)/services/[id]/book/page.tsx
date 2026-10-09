import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock3, Info, ShieldCheck, Sparkles } from "lucide-react";
import { getCurrentUser } from "@/server/authz";
import { getService } from "@/server/services/catalog";
import { NotFoundError } from "@/server/errors";
import { getConfig } from "@/lib/config";
import { formatDuration, formatPrice } from "@/lib/money";
import { isDateKey, todayKey } from "@/lib/time";
import { PageBody, PageHeader } from "@/components/common/page";
import { BookingWorkspace } from "@/components/booking/booking-workspace";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function loadService(id: string) {
  try {
    return await getService(decodeURIComponent(id));
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params;
  const service = await getService(decodeURIComponent(id)).catch(() => null);
  return { title: service ? `Book ${service.name}` : "Service not found" };
}

export default async function BookServicePage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const [service, user] = await Promise.all([loadService(id), getCurrentUser()]);
  const { BUSINESS_TIMEZONE: tz, CANCELLATION_CUTOFF_HOURS, BOOKING_MIN_LEAD_MINUTES } = getConfig();
  const today = todayKey(tz);
  const requested = typeof sp.date === "string" && isDateKey(sp.date) && sp.date >= today ? sp.date : undefined;

  const info = (
    <div className="flex flex-col gap-5 2xl:sticky 2xl:top-6">
      <div className="space-y-3">
        <p className="text-label font-semibold uppercase text-ink-subtle">{service.category}</p>
        <p className="max-w-[68ch] text-body text-ink-muted">{service.description}</p>
      </div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line text-[0.875rem]">
        <div className="bg-surface px-4 py-3">
          <dt className="text-meta text-ink-muted">Duration</dt>
          <dd className="mt-0.5 flex items-center gap-1.5 font-semibold">
            <Clock3 className="size-3.5 text-ink-muted" aria-hidden /> {formatDuration(service.durationMinutes)}
          </dd>
        </div>
        <div className="bg-surface px-4 py-3">
          <dt className="text-meta text-ink-muted">Price</dt>
          <dd className="mt-0.5 font-display text-[1.0625rem] font-bold">{formatPrice(service.priceCents, service.currency)}</dd>
        </div>
      </dl>
      <ul className="flex flex-col gap-2.5 text-meta text-ink-muted">
        <li className="flex gap-2.5">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand-soft" aria-hidden />
          Each time can be held by one person only — your confirmation is guaranteed by the booking database.
        </li>
        <li className="flex gap-2.5">
          <Info className="mt-0.5 size-4 shrink-0 text-brand-soft" aria-hidden />
          Online booking closes {BOOKING_MIN_LEAD_MINUTES} minutes before each appointment. Free cancellation up to {CANCELLATION_CUTOFF_HOURS} hours
          before.
        </li>
        <li className="flex gap-2.5">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-brand-soft" aria-hidden />
          <span>
            Questions about this service?{" "}
            <Link href={`/assistant?q=${encodeURIComponent(`Tell me about ${service.name}`)}`} className="font-medium text-brand underline-offset-4 hover:underline">
              Ask the assistant
            </Link>
          </span>
        </li>
      </ul>
    </div>
  );

  return (
    <PageBody>
      <PageHeader
        breadcrumbs={[{ label: "Services", href: "/" }, { label: service.name }]}
        title={service.name}
        description="Pick an open time below. Availability is read live from the studio calendar and re-checked when you confirm."
      />
      <BookingWorkspace
        service={{
          id: service.id,
          slug: service.slug,
          name: service.name,
          durationMinutes: service.durationMinutes,
          priceCents: service.priceCents,
          currency: service.currency,
        }}
        timeZone={tz}
        today={today}
        initialDate={requested}
        signedIn={Boolean(user)}
        cutoffHours={CANCELLATION_CUTOFF_HOURS}
        info={info}
      />
    </PageBody>
  );
}
