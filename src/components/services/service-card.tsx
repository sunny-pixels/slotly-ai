import Link from "next/link";
import { ArrowUpRight, Clock3 } from "lucide-react";
import type { ServiceView } from "@/server/services/catalog";
import { formatDuration, formatPrice } from "@/lib/money";
import { formatInZone } from "@/lib/time";
import { cn } from "@/lib/utils";

const categoryAccent: Record<string, string> = {
  Consultations: "bg-[#e7eef7] text-[#24507a]",
  Coaching: "bg-[#f3ecdf] text-[#7a5418]",
  Wellness: "bg-accent-faint text-brand",
  Health: "bg-[#f4e9ee] text-[#7c2d4f]",
};

export function ServiceCard({ service, timeZone }: { service: ServiceView; timeZone: string }) {
  const next = service.nextAvailableAt;
  return (
    <article className="group relative flex flex-col rounded-lg border border-line bg-surface p-5 transition-colors hover:border-line-strong">
      <div className="flex items-start justify-between gap-3">
        <span className={cn("rounded-sm px-2 py-0.5 text-[0.75rem] font-medium", categoryAccent[service.category] ?? "bg-canvas-sunken text-ink-muted")}>
          {service.category}
        </span>
        <span className="font-display text-[1.0625rem] font-bold tabular text-ink">{formatPrice(service.priceCents, service.currency)}</span>
      </div>

      <h3 className="mt-4 text-card-title font-semibold">
        <Link href={`/services/${service.slug}/book`} className="after:absolute after:inset-0 after:rounded-lg focus-visible:shadow-none">
          {service.name}
        </Link>
      </h3>
      <p className="mt-1.5 line-clamp-3 text-meta text-ink-muted">{service.description}</p>

      <div className="mt-auto flex items-end justify-between gap-3 pt-5">
        <div className="space-y-1 text-meta">
          <p className="flex items-center gap-1.5 text-ink-muted">
            <Clock3 className="size-3.5" aria-hidden /> {formatDuration(service.durationMinutes)}
          </p>
          {next ? (
            <p className="flex items-center gap-1.5 font-medium text-success">
              <span aria-hidden className="size-1.5 rounded-full bg-success" />
              Next: {formatInZone(next, "EEE d MMM, HH:mm", timeZone)}
            </p>
          ) : (
            <p className="text-ink-subtle">No open times in the published calendar</p>
          )}
        </div>
        <span
          aria-hidden
          className="flex size-8 items-center justify-center rounded-full border border-line text-ink-muted transition-colors group-hover:border-brand group-hover:bg-brand group-hover:text-white"
        >
          <ArrowUpRight className="size-4" />
        </span>
      </div>
    </article>
  );
}
