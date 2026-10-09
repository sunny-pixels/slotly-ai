"use client";

import Link from "next/link";
import { RefreshCw, ServerCrash } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-danger-bg text-danger">
        <ServerCrash className="size-6" aria-hidden />
      </span>
      <div className="space-y-1">
        <h1 className="text-section font-semibold">This page couldn&rsquo;t load</h1>
        <p className="max-w-[46ch] text-meta text-ink-muted">
          Something went wrong while fetching data — often a brief database connection issue. No booking was changed.
        </p>
      </div>
      <div className="flex gap-2">
        <Button onClick={reset}>
          <RefreshCw /> Try again
        </Button>
        <Link href="/" className={buttonVariants({ variant: "secondary" })}>
          Go to services
        </Link>
      </div>
    </div>
  );
}
