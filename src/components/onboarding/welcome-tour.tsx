"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  ArrowLeft,
  ArrowRight,
  CalendarCheck2,
  Check,
  ClipboardList,
  Loader2,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { continueAsAction } from "@/app/actions/auth";
import { DEMO_ACCOUNTS } from "@/lib/demo-accounts";
import { OPEN_TOUR_EVENT, useLocalFlag } from "@/lib/use-local-flag";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export const TOUR_SEEN_KEY = "slotly.tour.seen.v1";

type Step = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
};

const STEPS: Step[] = [
  {
    id: "welcome",
    label: "Welcome",
    icon: Sparkles,
    eyebrow: "Welcome to Slotly AI",
    title: "Book smarter. Never double-book.",
    body: "Slotly is a booking platform for a fictional studio offering consultations, coaching and wellness sessions. Everything you see — services, prices and policies — is demo data, so feel free to click around.",
    points: [
      "Live availability straight from the booking database",
      "Every time slot can be held by one person only — guaranteed by PostgreSQL",
      "An AI assistant that answers from the studio's own documents",
    ],
  },
  {
    id: "accounts",
    label: "Pick an account",
    icon: Users,
    eyebrow: "Step 1",
    title: "Choose a demo account — no sign-up needed",
    body: "There are no passwords in this demo. Pick who you want to be; you can switch at any time from the account panel at the bottom of the sidebar.",
    points: [],
  },
  {
    id: "book",
    label: "Book a service",
    icon: CalendarCheck2,
    eyebrow: "Step 2",
    title: "Book a time in four clicks",
    body: "Open Services, choose what you need, then pick a day and an open time.",
    points: [
      "Days show how many times are still open",
      "Booked or unavailable times are visible but can't be selected",
      "Review the summary and press Confirm — you get a reference like SLT-7KQ2MD",
      "If someone else takes the time first, you'll be told — never double-booked",
    ],
  },
  {
    id: "assistant",
    label: "Ask the assistant",
    icon: Sparkles,
    eyebrow: "Step 3",
    title: "Ask in plain English",
    body: "The Assistant page answers questions and finds times for you. Not sure what to type? Use the “Try asking” list on the right.",
    points: [
      "Policy answers quote the studio's documents — tap “Show where this came from”",
      "“Any massage slots tomorrow afternoon?” checks live availability",
      "It can prepare a booking or cancellation, but nothing changes until you confirm",
    ],
  },
  {
    id: "manage",
    label: "Manage bookings",
    icon: ClipboardList,
    eyebrow: "Step 4",
    title: "Everything you've booked, in one place",
    body: "My bookings lists upcoming, past and cancelled appointments with their references and prices.",
    points: [
      "Cancel free of charge up to 24 hours before the start time",
      "A cancelled time is released immediately for other customers",
      "Open any booking to see its details and the cancellation policy",
    ],
  },
  {
    id: "admin",
    label: "Studio admin",
    icon: ShieldCheck,
    eyebrow: "Step 5",
    title: "See the studio side as Priya (admin)",
    body: "Switch to the admin account to explore the tools a studio manager would use.",
    points: [
      "Overview — live figures and today's agenda",
      "Availability — opening hours, slot generation and blocking",
      "Services, all bookings, and the knowledge base the assistant reads",
    ],
  },
];

/**
 * First-visit product tour. Opens automatically once per browser, and again
 * whenever the "Product tour" link in the sidebar is used.
 */
export function WelcomeTour({ currentUserName }: { currentUserName: string | null }) {
  const [seen, setSeen] = useLocalFlag(TOUR_SEEN_KEY);
  const [manualOpen, setManualOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [pending, startTransition] = useTransition();
  const [picking, setPicking] = useState<string | null>(null);
  const pathname = usePathname();
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const open = () => {
      setStep(0);
      setManualOpen(true);
    };
    window.addEventListener(OPEN_TOUR_EVENT, open);
    return () => window.removeEventListener(OPEN_TOUR_EVENT, open);
  }, []);

  const open = manualOpen || seen === false;
  const current = STEPS[step];
  const last = step === STEPS.length - 1;

  function close() {
    setSeen(true);
    setManualOpen(false);
  }

  function pick(key: string) {
    setPicking(key);
    const fd = new FormData();
    fd.set("account", key);
    fd.set("callbackUrl", key === "admin" ? "/admin" : pathname.startsWith("/admin") ? "/" : pathname);
    startTransition(async () => {
      // Mark the tour done first: the server action redirects and re-renders the page.
      setSeen(true);
      setManualOpen(false);
      await continueAsAction(fd);
    });
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && close()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-brand-strong/45 data-[state=open]:animate-fade-in" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-line bg-surface shadow-pop data-[state=open]:animate-pop-in md:w-[min(56rem,calc(100vw-4rem))] md:grid-cols-[16rem_minmax(0,1fr)]"
          aria-describedby="tour-body"
          onOpenAutoFocus={(e) => {
            // Start keyboard focus on the main call to action rather than the first step in the list.
            e.preventDefault();
            primaryRef.current?.focus();
          }}
        >
          {/* Left: brand panel with step list */}
          <div className="hidden flex-col justify-between bg-brand p-6 text-white md:flex">
            <div>
              <p className="text-label font-semibold uppercase tracking-wide text-accent">Quick start</p>
              <p className="mt-1 font-display text-[1.125rem] font-bold leading-snug">How Slotly works</p>
            </div>
            <ol className="my-8 flex flex-col gap-1">
              {STEPS.map((s, i) => {
                const done = i < step;
                const active = i === step;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => setStep(i)}
                      aria-current={active ? "step" : undefined}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-[0.8125rem] transition-colors",
                        active ? "bg-white/12 font-semibold text-white" : "text-white/65 hover:bg-white/8 hover:text-white",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-6 shrink-0 items-center justify-center rounded-full border text-[0.6875rem] font-bold",
                          active ? "border-accent bg-accent text-brand-strong" : done ? "border-accent/60 text-accent" : "border-white/30",
                        )}
                      >
                        {done ? <Check className="size-3.5" /> : i + 1}
                      </span>
                      {s.label}
                    </button>
                  </li>
                );
              })}
            </ol>
            <p className="text-[0.75rem] leading-relaxed text-white/55">Demo product · fictional studio data. Reopen this guide any time from “Product tour” in the sidebar.</p>
          </div>

          {/* Right: step content */}
          <div className="flex min-h-[30rem] min-w-0 flex-col overflow-y-auto">
            <div className="flex items-center justify-between gap-3 px-6 pt-5 sm:px-8">
              <div className="flex items-center gap-1.5 md:hidden" aria-hidden>
                {STEPS.map((s, i) => (
                  <span key={s.id} className={cn("h-1.5 rounded-full transition-all", i === step ? "w-6 bg-brand" : "w-1.5 bg-line-strong")} />
                ))}
              </div>
              <p className="hidden text-meta text-ink-subtle tabular md:block">
                {step + 1} of {STEPS.length}
              </p>
              <DialogPrimitive.Close className="flex items-center gap-1 rounded-md px-2 py-1 text-meta text-ink-muted hover:bg-canvas-sunken hover:text-ink">
                Skip tour <X className="size-3.5" />
              </DialogPrimitive.Close>
            </div>

            <div key={current.id} className="flex flex-1 flex-col px-6 py-6 animate-fade-in sm:px-8">
              <span className="flex size-12 items-center justify-center rounded-xl bg-accent-faint text-brand">
                <current.icon className="size-6" />
              </span>
              <p className="mt-5 text-label font-semibold uppercase tracking-wide text-brand-soft">{current.eyebrow}</p>
              <DialogPrimitive.Title className="mt-1 font-display text-[clamp(1.375rem,1.1rem+0.8vw,1.75rem)] font-bold leading-tight tracking-tight">
                {current.title}
              </DialogPrimitive.Title>
              <p id="tour-body" className="mt-3 max-w-[56ch] text-body text-ink-muted">
                {current.body}
              </p>

              {current.points.length > 0 && (
                <ul className="mt-5 flex flex-col gap-2.5">
                  {current.points.map((p) => (
                    <li key={p} className="flex gap-2.5 text-[0.9375rem] text-ink">
                      <span className="mt-1 flex size-4 shrink-0 items-center justify-center rounded-full bg-success-bg text-success">
                        <Check className="size-3" />
                      </span>
                      {p}
                    </li>
                  ))}
                </ul>
              )}

              {current.id === "accounts" &&
                (currentUserName ? (
                  <p className="mt-5 rounded-lg bg-accent-faint px-4 py-3 text-[0.9375rem] text-brand">
                    You&rsquo;re using <strong>{currentUserName}</strong>. Switch any time from the account panel in the sidebar.
                  </p>
                ) : (
                  <ul className="mt-5 grid gap-2 sm:grid-cols-3">
                    {DEMO_ACCOUNTS.map((a) => (
                      <li key={a.key}>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => pick(a.key)}
                          className="flex h-full w-full flex-col items-start gap-2 rounded-lg border border-line bg-surface p-3.5 text-left transition-colors hover:border-brand hover:bg-accent-faint disabled:opacity-60"
                        >
                          <span
                            className={cn(
                              "flex size-8 items-center justify-center rounded-full",
                              a.role === "ADMIN" ? "bg-brand text-accent" : "bg-accent-faint text-brand",
                            )}
                            aria-hidden
                          >
                            {picking === a.key ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : a.role === "ADMIN" ? (
                              <ShieldCheck className="size-4" />
                            ) : (
                              <UserRound className="size-4" />
                            )}
                          </span>
                          <span className="text-[0.875rem] font-semibold text-ink">
                            {a.name}{" "}
                            <span className="text-[0.6875rem] font-medium uppercase tracking-wide text-ink-subtle">
                              {a.role === "ADMIN" ? "Admin" : "Customer"}
                            </span>
                          </span>
                          <span className="text-meta text-ink-muted">{a.description}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ))}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-line bg-surface-muted px-6 py-4 sm:px-8">
              <Button variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={step === 0} className={cn(step === 0 && "invisible")}>
                <ArrowLeft /> Back
              </Button>
              {last ? (
                <Button ref={primaryRef} onClick={close}>
                  Get started <ArrowRight />
                </Button>
              ) : (
                <Button ref={primaryRef} onClick={() => setStep((s) => s + 1)}>
                  {step === 0 ? "Show me around" : current.id === "accounts" && !currentUserName ? "Decide later" : "Next"} <ArrowRight />
                </Button>
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
