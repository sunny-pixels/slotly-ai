import * as React from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type Crumb = { label: string; href?: string };

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-meta text-ink-muted">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((item, i) => (
          <li key={`${item.label}-${i}`} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="size-3.5 text-ink-subtle" aria-hidden />}
            {item.href && i < items.length - 1 ? (
              <Link href={item.href} className="rounded-sm hover:text-ink hover:underline underline-offset-4">
                {item.label}
              </Link>
            ) : (
              <span aria-current={i === items.length - 1 ? "page" : undefined} className={cn(i === items.length - 1 && "text-ink")}>
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Full-width page heading row: title + description on the left, actions on the right. */
export function PageHeader({
  title,
  description,
  eyebrow,
  breadcrumbs,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  breadcrumbs?: Crumb[];
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-4 border-b border-line pb-6", className)}>
      {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 space-y-1.5">
          {eyebrow && <p className="text-label font-semibold uppercase text-brand-soft">{eyebrow}</p>}
          <h1 className="text-page-title font-bold">{title}</h1>
          {description && <p className="max-w-[68ch] text-body text-ink-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/** Section heading inside a page — typographic, not a boxed card. */
export function SectionHeader({ title, description, actions, id }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; id?: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-0.5">
        <h2 id={id} className="text-section font-semibold">
          {title}
        </h2>
        {description && <p className="text-meta text-ink-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

/** Page body with consistent vertical rhythm. Width is never capped — it fills the workspace. */
export function PageBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-(--section-gap) py-6 lg:py-8", className)} {...props} />;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-line-strong px-6 py-14 text-center", className)}>
      {Icon && (
        <span className="flex size-10 items-center justify-center rounded-full bg-accent-faint text-brand">
          <Icon className="size-5" />
        </span>
      )}
      <div className="space-y-1">
        <p className="font-display text-card-title font-semibold">{title}</p>
        {description && <p className="mx-auto max-w-[48ch] text-meta text-ink-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
