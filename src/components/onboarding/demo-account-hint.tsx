"use client";

import { Compass, X } from "lucide-react";
import { openTour, useLocalFlag } from "@/lib/use-local-flag";

export const HINT_DISMISSED_KEY = "slotly.account-hint.dismissed.v1";

/**
 * First-visit callout pointing at the account panel: explains that the demo
 * runs on sample accounts (two customers and an admin). Dismissed once per browser.
 */
export function DemoAccountHint({ signedIn }: { signedIn: boolean }) {
  const [dismissed, setDismissed] = useLocalFlag(HINT_DISMISSED_KEY);
  if (dismissed !== false) return null; // unknown during hydration, or dismissed

  return (
    <div role="note" className="relative mb-3 rounded-lg border border-brand-soft/30 bg-accent-faint p-3.5 text-[0.8125rem] text-ink shadow-xs animate-pop-in">
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="absolute right-2 top-2 rounded-sm p-1 text-ink-muted hover:bg-white/60 hover:text-ink"
        aria-label="Dismiss tip"
      >
        <X className="size-3.5" />
      </button>
      <p className="pr-5 font-semibold text-brand">{signedIn ? "Try the other demo accounts" : "New here? Use a demo account"}</p>
      <p className="mt-1 leading-relaxed text-ink-muted">
        {signedIn ? (
          <>
            Switch below at any time: <strong className="font-medium text-ink">Ananya</strong> and <strong className="font-medium text-ink">Rohan</strong> are customers,{" "}
            <strong className="font-medium text-ink">Priya</strong> is the studio admin.
          </>
        ) : (
          <>
            No sign-up needed. <strong className="font-medium text-ink">Ananya</strong> and <strong className="font-medium text-ink">Rohan</strong> are customer accounts;{" "}
            <strong className="font-medium text-ink">Priya</strong> is the admin account.
          </>
        )}
      </p>
      <button type="button" onClick={openTour} className="mt-2.5 inline-flex items-center gap-1.5 font-medium text-brand underline-offset-4 hover:underline">
        <Compass className="size-3.5" /> Take the product tour
      </button>
      {/* Pointer towards the account panel below */}
      <span aria-hidden className="absolute -bottom-[7px] left-7 size-3 rotate-45 border-b border-r border-brand-soft/30 bg-accent-faint" />
    </div>
  );
}
