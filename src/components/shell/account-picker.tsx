"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useFormStatus } from "react-dom";
import { ChevronRight, Loader2, ShieldCheck, UserRound } from "lucide-react";
import { continueAsAction } from "@/app/actions/auth";
import { DEMO_ACCOUNTS } from "@/lib/demo-accounts";
import { cn } from "@/lib/utils";

function useCurrentPath(override?: string) {
  const pathname = usePathname();
  const search = useSearchParams();
  if (override) return override;
  const qs = search.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

function PendingIcon() {
  const { pending } = useFormStatus();
  return pending ? <Loader2 className="size-4 animate-spin text-ink-muted" aria-hidden /> : <ChevronRight className="size-4 text-ink-subtle" aria-hidden />;
}

/**
 * Lists the demo identities. Each choice is a tiny form posting only the
 * account key to a server action, which starts a real Auth.js session.
 */
export function AccountPicker({ callbackUrl, compact = false, className }: { callbackUrl?: string; compact?: boolean; className?: string }) {
  const path = useCurrentPath(callbackUrl);
  return (
    <ul className={cn("flex flex-col gap-2", className)}>
      {DEMO_ACCOUNTS.map((a) => (
        <li key={a.key}>
          <form action={continueAsAction}>
            <input type="hidden" name="account" value={a.key} />
            <input type="hidden" name="callbackUrl" value={path} />
            <button
              type="submit"
              className="flex w-full items-center gap-3 rounded-md border border-line bg-surface px-3 py-2.5 text-left transition-colors hover:border-brand-soft hover:bg-accent-faint"
            >
              <span
                aria-hidden
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full",
                  a.role === "ADMIN" ? "bg-brand text-accent" : "bg-accent-faint text-brand",
                )}
              >
                {a.role === "ADMIN" ? <ShieldCheck className="size-4" /> : <UserRound className="size-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[0.875rem] font-semibold text-ink">
                  {a.name}{" "}
                  <span className="ml-1 text-[0.6875rem] font-medium uppercase tracking-wide text-ink-subtle">
                    {a.role === "ADMIN" ? "Admin" : "Customer"}
                  </span>
                </span>
                {!compact && <span className="block truncate text-meta text-ink-muted">{a.description}</span>}
              </span>
              <PendingIcon />
            </button>
          </form>
        </li>
      ))}
    </ul>
  );
}

/** Inline prompt shown wherever an action needs an identity. */
export function SignInPrompt({ title = "Choose a demo account", description, callbackUrl }: { title?: string; description?: string; callbackUrl?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-5">
      <p className="font-display text-card-title font-semibold">{title}</p>
      <p className="mt-1 text-meta text-ink-muted">
        {description ?? "This demo has no passwords — continue as one of the sample accounts. Each account only sees its own bookings."}
      </p>
      <AccountPicker callbackUrl={callbackUrl} className="mt-4" />
    </div>
  );
}
