import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Link-based pagination: works without JavaScript and keeps filters in the URL. */
export function Pagination({
  page,
  pageSize,
  total,
  hrefFor,
}: {
  page: number;
  pageSize: number;
  total: number;
  hrefFor: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 text-meta text-ink-muted">
      <p className="tabular">
        {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} className={buttonVariants({ variant: "secondary", size: "sm" })} rel="prev">
            <ChevronLeft /> Previous
          </Link>
        ) : (
          <span className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "pointer-events-none opacity-50")} aria-disabled>
            <ChevronLeft /> Previous
          </span>
        )}
        <span className="px-2 tabular">
          {page} / {pages}
        </span>
        {page < pages ? (
          <Link href={hrefFor(page + 1)} className={buttonVariants({ variant: "secondary", size: "sm" })} rel="next">
            Next <ChevronRight />
          </Link>
        ) : (
          <span className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "pointer-events-none opacity-50")} aria-disabled>
            Next <ChevronRight />
          </span>
        )}
      </div>
    </nav>
  );
}
