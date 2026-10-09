import Link from "next/link";
import { ArrowRight, SearchX, ShieldCheck, Sparkles } from "lucide-react";
import { listCategories, listServices } from "@/server/services/catalog";
import { getConfig } from "@/lib/config";
import { serviceListQuerySchema } from "@/lib/validators";
import { ServiceCard } from "@/components/services/service-card";
import { EmptyState, PageBody, SectionHeader } from "@/components/common/page";
import { Input, NativeSelect } from "@/components/ui/field";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata = { title: "Services" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ServicesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const raw = { q: first(sp.q), category: first(sp.category), maxPrice: first(sp.maxPrice) || undefined, maxDuration: first(sp.maxDuration) || undefined };
  const parsed = serviceListQuerySchema.safeParse(raw);
  const filters = parsed.success ? parsed.data : serviceListQuerySchema.parse({});
  const { BUSINESS_TIMEZONE: tz } = getConfig();
  const [{ items, total }, categories] = await Promise.all([listServices(filters), listCategories()]);
  const filtering = Boolean(filters.q || filters.category || filters.maxPrice || filters.maxDuration);

  const hrefWith = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const merged = { q: filters.q, category: filters.category, maxPrice: filters.maxPrice?.toString(), maxDuration: filters.maxDuration?.toString(), ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const s = params.toString();
    return s ? `/?${s}` : "/";
  };

  return (
    <PageBody>
      {/* Compact introduction — product context plus a working entry point to the assistant */}
      <section className="grid gap-6 border-b border-line pb-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(22rem,0.85fr)] lg:items-end lg:gap-12">
        <div className="space-y-4">
          <p className="inline-flex items-center gap-2 text-label font-semibold uppercase text-brand-soft">
            <span aria-hidden className="size-1.5 rounded-full bg-success" /> Live availability · Demo studio
          </p>
          <h1 className="max-w-[18ch] font-display text-[clamp(1.875rem,1.2rem+2vw,2.875rem)] font-extrabold leading-[1.05] tracking-[-0.03em]">
            Book smarter. Never double&#8209;book.
          </h1>
          <p className="max-w-[60ch] text-body text-ink-muted">
            Browse consultations, coaching and wellness sessions, pick a time that is genuinely free, and get a confirmation the database
            guarantees. Every slot can be held by exactly one person — even when two people click at the same moment.
          </p>
          <p className="flex items-center gap-2 text-meta text-ink-muted">
            <ShieldCheck className="size-4 text-brand-soft" aria-hidden />
            Services, prices and policies shown here are demonstration data for a fictional studio.
          </p>
        </div>

        <form action="/assistant" method="get" className="rounded-lg border border-line bg-brand p-5 text-white">
          <label htmlFor="assistant-q" className="flex items-center gap-2 font-display text-card-title font-semibold">
            <Sparkles className="size-4 text-accent" aria-hidden /> Ask the booking assistant
          </label>
          <p className="mt-1 text-meta text-white/70">Policies, recommendations or live open times — answers cite their sources.</p>
          <div className="mt-4 flex gap-2">
            <Input
              id="assistant-q"
              name="q"
              required
              maxLength={300}
              placeholder="e.g. Any massage slots on Friday afternoon?"
              className="border-white/15 bg-white/10 text-white placeholder:text-white/50 hover:border-white/30 focus-visible:border-accent"
            />
            <Button type="submit" variant="accent" aria-label="Ask">
              Ask <ArrowRight />
            </Button>
          </div>
        </form>
      </section>

      <section aria-labelledby="services-heading" className="flex flex-col gap-5">
        <SectionHeader
          id="services-heading"
          title="Services"
          description={filtering ? `${total} matching service${total === 1 ? "" : "s"}` : `${total} services, with the next bookable time for each`}
        />

        {/* Filters: plain GET form — shareable URLs, works without JavaScript */}
        <form method="get" action="/" className="grid gap-3 rounded-lg bg-canvas-sunken/70 p-3 sm:grid-cols-2 lg:grid-cols-[minmax(14rem,1.6fr)_repeat(3,minmax(9rem,1fr))_auto]">
          <div>
            <label htmlFor="q" className="sr-only">
              Search services
            </label>
            <Input id="q" name="q" defaultValue={filters.q ?? ""} placeholder="Search by name or need — e.g. back pain" maxLength={100} />
          </div>
          <div>
            <label htmlFor="category" className="sr-only">
              Category
            </label>
            <NativeSelect id="category" name="category" defaultValue={filters.category ?? ""}>
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div>
            <label htmlFor="maxPrice" className="sr-only">
              Maximum price
            </label>
            <NativeSelect id="maxPrice" name="maxPrice" defaultValue={filters.maxPrice?.toString() ?? ""}>
              <option value="">Any price</option>
              <option value="30">Up to £30</option>
              <option value="50">Up to £50</option>
              <option value="70">Up to £70</option>
              <option value="100">Up to £100</option>
            </NativeSelect>
          </div>
          <div>
            <label htmlFor="maxDuration" className="sr-only">
              Maximum duration
            </label>
            <NativeSelect id="maxDuration" name="maxDuration" defaultValue={filters.maxDuration?.toString() ?? ""}>
              <option value="">Any length</option>
              <option value="30">30 min or less</option>
              <option value="45">45 min or less</option>
              <option value="60">1 hour or less</option>
            </NativeSelect>
          </div>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
            <Button type="submit" className="flex-1 lg:flex-none">
              Apply
            </Button>
            {filtering && (
              <Link href="/" className={cn(buttonVariants({ variant: "ghost" }))}>
                Clear
              </Link>
            )}
          </div>
        </form>

        {categories.length > 1 && (
          <nav aria-label="Categories" className="-mt-1 flex flex-wrap gap-2">
            {[undefined, ...categories].map((c) => {
              const active = (filters.category ?? undefined) === c;
              return (
                <Link
                  key={c ?? "all"}
                  href={hrefWith({ category: c })}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "rounded-full border px-3 py-1 text-meta font-medium transition-colors",
                    active ? "border-brand bg-brand text-white" : "border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink",
                  )}
                >
                  {c ?? "All"}
                </Link>
              );
            })}
          </nav>
        )}

        {items.length === 0 ? (
          <EmptyState
            icon={SearchX}
            title="No services match these filters"
            description="Try a broader search, or ask the assistant to recommend something for your situation."
            action={
              <div className="flex gap-2">
                <Link href="/" className={buttonVariants({ variant: "secondary" })}>
                  Clear filters
                </Link>
                <Link href="/assistant" className={buttonVariants({ variant: "primary" })}>
                  Ask the assistant
                </Link>
              </div>
            }
          />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,19rem),1fr))] gap-4">
            {items.map((s) => (
              <ServiceCard key={s.id} service={s} timeZone={tz} />
            ))}
          </div>
        )}
      </section>
    </PageBody>
  );
}
