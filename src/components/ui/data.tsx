import * as React from "react";
import { cn } from "@/lib/utils";

/** Table primitives. Wrap in <TableFrame> for borders and horizontal scroll on narrow screens. */
export function TableFrame({ className, ...props }: React.ComponentProps<"div">) {
  // `relative` makes this the containing block for absolutely positioned descendants
  // (sr-only labels, Radix hidden inputs) so they scroll with the table instead of widening the page.
  return <div className={cn("relative w-full overflow-x-auto rounded-lg border border-line bg-surface", className)} {...props} />;
}

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return <table className={cn("w-full border-collapse text-left text-[0.875rem]", className)} {...props} />;
}

export function THead({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("bg-surface-muted", className)} {...props} />;
}

export function TH({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      scope="col"
      className={cn(
        "whitespace-nowrap border-b border-line px-4 py-2.5 text-label font-semibold uppercase text-ink-muted first:pl-5 last:pr-5",
        className,
      )}
      {...props}
    />
  );
}

export function TR({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn("border-b border-line last:border-0 hover:bg-surface-muted/70", className)} {...props} />;
}

export function TD({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("px-4 py-3 align-middle first:pl-5 last:pr-5", className)} {...props} />;
}

export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-canvas-sunken", className)} {...props} />;
}

/** Compact key/value list used in summaries and detail views. */
export function DetailList({ items, className }: { items: { label: string; value: React.ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3 text-[0.875rem] sm:grid-cols-[minmax(8rem,auto)_1fr]", className)}>
      {items.map((item) => (
        <React.Fragment key={item.label}>
          <dt className="text-ink-muted">{item.label}</dt>
          <dd className="font-medium text-ink">{item.value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}
