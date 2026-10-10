"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, BookOpenText, CalendarClock, CheckCircle2, Database, FileText, LogIn, RefreshCw, Search, Sparkles, TriangleAlert } from "lucide-react";
import type { AssistantReply, OpenSlot, SourceRef } from "@/lib/assistant-types";
import { api, ApiError } from "@/lib/api-client";
import { formatDuration, formatPrice } from "@/lib/money";
import { formatInZone } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { BookingStatusBadge } from "@/components/common/status";
import { ConfirmBookingDialog } from "@/components/booking/confirm-booking-dialog";
import { CancelBookingButton } from "@/components/booking/cancel-booking-button";
import { AccountPicker } from "@/components/shell/account-picker";

type Message =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; reply: AssistantReply }
  | { id: string; role: "event"; tone: "success" | "warning"; text: string; href?: string }
  | { id: string; role: "error"; text: string; retry: string };

const SUGGESTIONS = [
  "What is your cancellation policy?",
  "Any massage slots tomorrow afternoon?",
  "Recommend something for stress under ₹1,000",
  "What are your opening hours on Saturday?",
  "Show my upcoming bookings",
  "Do you offer gift vouchers?",
];

/** Example questions, grouped the way customers think about them. Each one is routed by the assistant as written. */
const GUIDE: { title: string; icon: React.ComponentType<{ className?: string }>; needsAccount?: boolean; questions: string[] }[] = [
  {
    title: "Policies & info",
    icon: BookOpenText,
    questions: ["What is your cancellation policy?", "Can I reschedule my appointment?", "What are your opening hours on Saturday?", "Which payment methods do you accept?"],
  },
  {
    title: "Find a service",
    icon: Search,
    questions: ["Which services do you offer?", "Recommend something for stress under ₹1,000", "Recommend something for back pain"],
  },
  {
    title: "Open times",
    icon: CalendarClock,
    questions: ["Any massage slots tomorrow afternoon?", "Next available physio", "Meditation openings next week"],
  },
  {
    title: "Your bookings",
    icon: Database,
    needsAccount: true,
    questions: ["Show my upcoming bookings", "Book a massage on Monday morning", "Cancel my physio check-in"],
  },
];

/** Context-aware follow-ups for the latest answer. Uses real data from the reply (service names, open times). */
function relatedQuestions(reply: AssistantReply, signedIn: boolean, timeZone: string): { title: string; questions: string[] } {
  const title = "Related to your last question";
  const firstSlot = reply.slots?.[0];
  switch (reply.intent) {
    case "availability":
    case "book":
      if (firstSlot) {
        const name = firstSlot.service.name;
        return {
          title,
          questions: [
            ...(signedIn
              ? [`Book ${name} on ${formatInZone(firstSlot.startAt, "yyyy-MM-dd", timeZone)} at ${formatInZone(firstSlot.startAt, "HH:mm", timeZone)}`]
              : []),
            `${name} openings next week`,
            `Tell me about ${name}`,
            "What is your cancellation policy?",
          ],
        };
      }
      return { title, questions: ["Which services do you offer?", "Any massage slots tomorrow afternoon?", "What are your opening hours on Saturday?"] };
    case "service_search": {
      const names = (reply.services ?? []).slice(0, 2).map((s) => s.name);
      return {
        title,
        questions: [...names.map((n) => `Next available ${n}`), "Which services are under ₹1,500?", "What should I expect on my first visit?"],
      };
    }
    case "my_bookings":
    case "cancel":
      return {
        title,
        questions: ["What is your cancellation policy?", "Can I reschedule my appointment?", ...(reply.bookings?.length ? [] : ["Which services do you offer?"])],
      };
    case "greeting":
      return { title: "Good places to start", questions: ["Which services do you offer?", "What is your cancellation policy?", "Any massage slots tomorrow afternoon?"] };
    default:
      if (reply.mode === "no_answer" || reply.confidence === "low") {
        return {
          title: "Questions I can answer well",
          questions: ["What is your cancellation policy?", "What are your opening hours on Saturday?", "Can I have my session by video call?"],
        };
      }
      return {
        title,
        questions: ["Can I reschedule my appointment?", "What happens if I don't turn up?", "Which payment methods do you accept?", "Which services do you offer?"],
      };
  }
}

function QuestionList({ questions, onAsk, disabled }: { questions: string[]; onAsk: (q: string) => void; disabled?: boolean }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {questions.map((q) => (
        <li key={q}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onAsk(q)}
            className="group flex w-full items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-left text-[0.8125rem] text-ink transition-colors hover:border-brand-soft hover:bg-accent-faint disabled:opacity-50"
          >
            <span className="flex-1">{q}</span>
            <ArrowUp className="size-3.5 shrink-0 rotate-45 text-ink-subtle transition-colors group-hover:text-brand" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

const uid = () => Math.random().toString(36).slice(2);

export function AssistantWorkspace({
  signedIn,
  userName,
  timeZone,
  cutoffHours,
  generation,
  initialQuestion,
}: {
  signedIn: boolean;
  userName?: string;
  timeZone: string;
  cutoffHours: number;
  generation: string | null;
  initialQuestion?: string;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [bookingSlot, setBookingSlot] = useState<OpenSlot | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sentInitial = useRef(false);
  const guideRef = useRef<HTMLElement>(null);

  // Follow-up questions that fit the most recent answer.
  const related = useMemo(() => {
    const last = [...messages].reverse().find((m): m is Extract<Message, { role: "assistant" }> => m.role === "assistant");
    return last ? relatedQuestions(last.reply, signedIn, timeZone) : null;
  }, [messages, signedIn, timeZone]);

  // Bring fresh follow-up questions into view after each answer.
  useEffect(() => {
    if (related) guideRef.current?.scrollTo({ top: 0 });
  }, [related]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || pending) return;
    const history = messages
      .flatMap((m): { role: "user" | "assistant"; content: string }[] =>
        m.role === "user" ? [{ role: "user" as const, content: m.text }] : m.role === "assistant" ? [{ role: "assistant" as const, content: m.reply.text }] : [],
      )
      .slice(-6);
    setMessages((prev) => [...prev, { id: uid(), role: "user", text: message }]);
    setInput("");
    setPending(true);
    try {
      const { reply } = await api<{ reply: AssistantReply }>("/api/assistant/chat", { method: "POST", json: { message, history } });
      setMessages((prev) => [...prev, { id: reply.id, role: "assistant", reply }]);
    } catch (e) {
      const text =
        e instanceof ApiError && e.status === 429
          ? e.message
          : e instanceof ApiError && e.status > 0
            ? `The assistant couldn't answer (${e.message}). Booking from the services page still works.`
            : "The assistant is unreachable right now. You can still book directly from the services page.";
      setMessages((prev) => [...prev, { id: uid(), role: "error", text, retry: message }]);
    } finally {
      setPending(false);
      inputRef.current?.focus();
    }
  }

  useEffect(() => {
    if (initialQuestion && !sentInitial.current) {
      sentInitial.current = true;
      void send(initialQuestion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);

  return (
    <div className="grid min-h-0 flex-1 gap-6 pt-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
      {/* ── Conversation ──────────────────────────────────────────────── */}
      <section aria-label="Conversation" className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-surface">
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5 sm:px-6" aria-live="polite">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col justify-center gap-6 py-6">
              <div className="space-y-2">
                <span className="flex size-10 items-center justify-center rounded-lg bg-brand text-accent">
                  <Sparkles className="size-5" aria-hidden />
                </span>
                <h2 className="text-[1.375rem] font-bold tracking-tight">{userName ? `Hi ${userName}, how can I help?` : "How can I help you book?"}</h2>
                <p className="max-w-[60ch] text-meta text-ink-muted">
                  I answer from Slotly&rsquo;s published documents and check open times directly in the booking system. I never book or cancel
                  anything without your confirmation.
                </p>
              </div>
              <p className="hidden text-meta text-ink-muted lg:block">Pick a question from <strong className="font-medium text-ink">Try asking</strong> on the right, or type your own below.</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:hidden">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    className="rounded-md border border-line bg-surface-muted px-3.5 py-2.5 text-left text-[0.875rem] text-ink transition-colors hover:border-brand-soft hover:bg-accent-faint"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ol className="flex flex-col gap-6">
              {messages.map((m) => (
                <li key={m.id}>
                  {m.role === "user" && (
                    <div className="flex justify-end">
                      <p className="max-w-[min(85%,40rem)] whitespace-pre-wrap rounded-lg rounded-br-sm bg-brand px-4 py-2.5 text-[0.9375rem] text-white">{m.text}</p>
                    </div>
                  )}
                  {m.role === "assistant" && (
                    <AssistantMessage
                      reply={m.reply}
                      signedIn={signedIn}
                      timeZone={timeZone}
                      onSuggestion={(s) => void send(s)}
                      onBook={(slot) => setBookingSlot(slot)}
                    />
                  )}
                  {m.role === "event" && (
                    <p
                      className={cn(
                        "flex items-center gap-2 rounded-md px-3 py-2 text-[0.875rem]",
                        m.tone === "success" ? "bg-success-bg text-success" : "bg-warning-bg text-warning",
                      )}
                    >
                      {m.tone === "success" ? <CheckCircle2 className="size-4" /> : <TriangleAlert className="size-4" />}
                      <span className="flex-1">{m.text}</span>
                      {m.href && (
                        <Link href={m.href} className="font-medium underline underline-offset-4">
                          View
                        </Link>
                      )}
                    </p>
                  )}
                  {m.role === "error" && (
                    <div role="alert" className="flex items-start gap-3 rounded-md bg-danger-bg px-4 py-3 text-[0.875rem] text-danger">
                      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                      <p className="flex-1">{m.text}</p>
                      <Button size="sm" variant="secondary" onClick={() => void send(m.retry)} disabled={pending}>
                        <RefreshCw /> Retry
                      </Button>
                    </div>
                  )}
                </li>
              ))}
              {pending && (
                <li className="flex items-center gap-3 text-meta text-ink-muted" aria-label="Assistant is working">
                  <span className="flex size-7 items-center justify-center rounded-md bg-accent-faint text-brand">
                    <Sparkles className="size-3.5 animate-pulse" />
                  </span>
                  Checking documents and live availability…
                </li>
              )}
            </ol>
          )}
        </div>

        <form
          className="border-t border-line bg-surface-muted p-3 sm:p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          <label htmlFor="assistant-input" className="sr-only">
            Message the booking assistant
          </label>
          <div className="flex items-end gap-2 rounded-lg border border-line-strong bg-surface p-1.5 focus-within:border-brand-soft">
            <Textarea
              id="assistant-input"
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              rows={1}
              maxLength={1000}
              placeholder="Ask about services, policies or open times…"
              className="max-h-40 min-h-10 resize-none border-0 shadow-none focus-visible:shadow-none"
            />
            <Button type="submit" size="icon" aria-label="Send" disabled={!input.trim() || pending} loading={pending && !!input}>
              {!pending && <ArrowUp />}
            </Button>
          </div>
          <p className="mt-2 px-1 text-[0.75rem] text-ink-subtle">
            {generation ? `Answers written by ${generation} from retrieved documents.` : "AI writing is off — answers quote the documentation directly."} Open times
            always come from the live booking system.
          </p>
        </form>
      </section>

      {/* ── Question guide: what a new customer can ask ───────────────── */}
      <aside ref={guideRef} aria-labelledby="guide-heading" className="hidden min-h-0 flex-col gap-5 overflow-y-auto pb-2 lg:flex">
        <div>
          <h2 id="guide-heading" className="text-section font-semibold">
            Try asking
          </h2>
          <p className="text-meta text-ink-muted">Not sure what to type? Click any question to send it.</p>
        </div>

        {related && related.questions.length > 0 && (
          <section aria-labelledby="related-heading" className="rounded-lg border border-brand-soft/30 bg-accent-faint/50 p-4">
            <h3 id="related-heading" className="mb-2.5 flex items-center gap-2 text-[0.8125rem] font-semibold text-brand">
              <Sparkles className="size-3.5" aria-hidden /> {related.title}
            </h3>
            <QuestionList questions={related.questions} onAsk={(q) => void send(q)} disabled={pending} />
          </section>
        )}

        {GUIDE.filter((g) => signedIn || !g.needsAccount).map((group) => (
          <section key={group.title} aria-labelledby={`guide-${group.title}`}>
            <h3 id={`guide-${group.title}`} className="mb-2 flex items-center gap-2 text-label font-semibold uppercase text-ink-subtle">
              <group.icon className="size-3.5" aria-hidden /> {group.title}
            </h3>
            <QuestionList questions={group.questions} onAsk={(q) => void send(q)} disabled={pending} />
          </section>
        ))}

        {!signedIn && (
          <p className="rounded-lg bg-canvas-sunken/70 p-3 text-meta text-ink-muted">
            Choose a demo account (bottom of the sidebar) to also ask about <em>your</em> bookings, book or cancel.
          </p>
        )}
      </aside>

      <ConfirmBookingDialog
        open={Boolean(bookingSlot)}
        onOpenChange={(o) => !o && setBookingSlot(null)}
        slot={bookingSlot}
        service={bookingSlot?.service ?? null}
        timeZone={timeZone}
        cutoffHours={cutoffHours}
        onBooked={(b) =>
          setMessages((prev) => [
            ...prev,
            {
              id: uid(),
              role: "event",
              tone: "success",
              text: `Booked ${b.service.name} on ${formatInZone(b.slot.startAt, "EEE d MMM 'at' HH:mm", timeZone)} — reference ${b.publicReference}.`,
              href: `/bookings/${b.id}`,
            },
          ])
        }
        onConflict={() =>
          setMessages((prev) => [
            ...prev,
            { id: uid(), role: "event", tone: "warning", text: "That time was just taken by someone else, so nothing was booked. Ask me for fresh times." },
          ])
        }
      />
    </div>
  );
}

function SourceCard({ source }: { source: SourceRef }) {
  return (
    <li className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 rounded-sm bg-accent-faint px-1.5 py-0.5 font-mono text-[0.6875rem] font-semibold text-brand">{source.label}</span>
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[0.875rem] font-semibold">
            <FileText className="size-3.5 shrink-0 text-ink-muted" aria-hidden />
            <span className="truncate">{source.documentTitle}</span>
          </p>
          <p className="text-[0.75rem] text-ink-muted">
            {source.headingPath ? `${source.headingPath} · ` : ""}v{source.version}
            {source.cited ? " · cited" : ""}
          </p>
        </div>
      </div>
      <blockquote className="mt-3 border-l-2 border-accent pl-3 text-meta text-ink-muted">{source.excerpt}</blockquote>
    </li>
  );
}

/** Renders [S1]-style citations as small chips. */
function CitedText({ text, sources }: { text: string; sources: SourceRef[] }) {
  const parts = text.split(/(\[S\d+\])/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(/^\[S(\d+)\]$/);
        if (!m) return <Fragment key={i}>{part}</Fragment>;
        const src = sources[Number(m[1]) - 1];
        if (!src) return null;
        return (
          <span
            key={i}
            title={`${src.documentTitle}${src.headingPath ? ` — ${src.headingPath}` : ""}`}
            className="mx-0.5 inline-flex -translate-y-px items-center rounded-sm bg-accent-faint px-1 align-middle font-mono text-[0.6875rem] font-semibold text-brand"
          >
            {src.label}
          </span>
        );
      })}
    </>
  );
}

const modeLabel: Partial<Record<AssistantReply["mode"], { text: string; icon: React.ComponentType<{ className?: string }> }>> = {
  llm: { text: "Answer based on Slotly’s documents", icon: BookOpenText },
  extractive: { text: "Quoted from Slotly’s documents", icon: FileText },
  no_answer: { text: "Not covered by Slotly’s documents", icon: TriangleAlert },
  tool: { text: "Checked live in the booking system", icon: Database },
  error: { text: "Assistant unavailable", icon: TriangleAlert },
};

function AssistantMessage({
  reply,
  signedIn,
  timeZone,
  onSuggestion,
  onBook,
}: {
  reply: AssistantReply;
  signedIn: boolean;
  timeZone: string;
  onSuggestion: (s: string) => void;
  onBook: (slot: OpenSlot) => void;
}) {
  const mode =
    reply.mode === "extractive" && reply.confidence === "low"
      ? { text: "Closest match in Slotly’s documents — may not answer this", icon: TriangleAlert }
      : modeLabel[reply.mode];
  const [showInline, setShowInline] = useState(false);
  const slotsByDay = useMemo(() => {
    const map = new Map<string, OpenSlot[]>();
    for (const s of reply.slots ?? []) {
      const key = formatInZone(s.startAt, "EEEE d MMMM", timeZone);
      map.set(key, [...(map.get(key) ?? []), s]);
    }
    return [...map.entries()];
  }, [reply.slots, timeZone]);
  const multiService = new Set((reply.slots ?? []).map((s) => s.service.id)).size > 1;
  const [pickAccount, setPickAccount] = useState(false);

  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-accent-faint text-brand" aria-hidden>
        <Sparkles className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1 space-y-3">
        {mode && (
          <p className={cn("flex items-center gap-1.5 text-[0.75rem] font-medium", reply.mode === "error" || reply.mode === "no_answer" ? "text-warning" : "text-ink-subtle")}>
            <mode.icon className="size-3.5" /> {mode.text}
          </p>
        )}
        <p className="whitespace-pre-wrap text-[0.9375rem] leading-relaxed text-ink">
          <CitedText text={reply.text} sources={reply.sources} />
        </p>
        {reply.notice && <p className="rounded-md bg-warning-bg px-3 py-2 text-meta text-warning">{reply.notice}</p>}

        {reply.sources.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {reply.sources.map((s) => (
              <span key={s.chunkId} className="inline-flex items-center gap-1 rounded-sm border border-line px-2 py-0.5 text-[0.75rem] text-ink-muted">
                <span className="font-mono font-semibold text-brand">{s.label}</span> {s.documentTitle}
              </span>
            ))}
            <button
              type="button"
              onClick={() => setShowInline((v) => !v)}
              aria-expanded={showInline}
              className="text-[0.75rem] font-medium text-brand underline-offset-4 hover:underline"
            >
              {showInline ? "Hide where this came from" : "Show where this came from"}
            </button>
          </div>
        )}
        {showInline && reply.sources.length > 0 && (
          <ol className="flex flex-col gap-2">
            {reply.sources.map((s) => (
              <SourceCard key={s.chunkId} source={s} />
            ))}
          </ol>
        )}

        {reply.services && reply.services.length > 0 && (
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
            {reply.services.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 bg-surface px-4 py-3">
                <div className="min-w-0">
                  <p className="font-semibold">{s.name}</p>
                  <p className="text-meta text-ink-muted">
                    {s.category} · {formatDuration(s.durationMinutes)} · {formatPrice(s.priceCents, s.currency)}
                    {s.nextAvailableAt ? ` · next ${formatInZone(s.nextAvailableAt, "EEE d MMM HH:mm", timeZone)}` : ""}
                  </p>
                </div>
                <Link href={`/services/${s.slug}/book`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
                  See times
                </Link>
              </li>
            ))}
          </ul>
        )}

        {slotsByDay.length > 0 && (
          <div className="space-y-3 rounded-lg border border-line bg-surface-muted p-4">
            {slotsByDay.map(([day, slots]) => (
              <div key={day} className="space-y-2">
                <p className="flex items-center gap-1.5 text-[0.8125rem] font-semibold">
                  <CalendarClock className="size-3.5 text-ink-muted" aria-hidden /> {day}
                </p>
                <div className="flex flex-wrap gap-2">
                  {slots.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => (signedIn ? onBook(s) : setPickAccount(true))}
                      className="rounded-md border border-brand-soft/40 bg-surface px-3 py-1.5 text-left text-[0.8125rem] font-semibold tabular text-brand transition-colors hover:border-brand hover:bg-accent-faint"
                      aria-label={`Book ${s.service.name} at ${formatInZone(s.startAt, "HH:mm 'on' EEEE d MMMM", timeZone)}`}
                    >
                      {formatInZone(s.startAt, "HH:mm", timeZone)}
                      {multiService && <span className="ml-1.5 font-normal text-ink-muted">{s.service.name}</span>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <p className="text-[0.75rem] text-ink-subtle">Selecting a time opens a confirmation step — nothing is booked until you confirm.</p>
          </div>
        )}

        {reply.proposal && (
          <div className="rounded-lg border border-brand-soft/40 bg-accent-faint/60 p-4">
            <p className="font-display text-card-title font-semibold">{reply.proposal.service.name}</p>
            <p className="text-meta text-ink-muted">
              {formatInZone(reply.proposal.startAt, "EEEE d MMMM, HH:mm", timeZone)} · {formatDuration(reply.proposal.service.durationMinutes)} ·{" "}
              {formatPrice(reply.proposal.service.priceCents, reply.proposal.service.currency)}
            </p>
            <div className="mt-3">
              {signedIn ? (
                <Button size="sm" onClick={() => onBook(reply.proposal!)}>
                  Review and confirm
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => setPickAccount(true)}>
                  <LogIn /> Choose an account to book
                </Button>
              )}
            </div>
          </div>
        )}

        {reply.cancellationTarget && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger/25 bg-surface p-4">
            <div>
              <p className="font-semibold">
                {reply.cancellationTarget.service.name} <span className="font-mono text-meta font-normal text-ink-muted">{reply.cancellationTarget.publicReference}</span>
              </p>
              <p className="text-meta text-ink-muted">{formatInZone(reply.cancellationTarget.slot.startAt, "EEEE d MMMM, HH:mm", timeZone)}</p>
            </div>
            <CancelBookingButton
              booking={{
                id: reply.cancellationTarget.id,
                publicReference: reply.cancellationTarget.publicReference,
                serviceName: reply.cancellationTarget.service.name,
                startAt: reply.cancellationTarget.slot.startAt,
              }}
              timeZone={timeZone}
              label="Cancel this booking"
            />
          </div>
        )}

        {reply.bookings && reply.bookings.length > 0 && (
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
            {reply.bookings.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 bg-surface px-4 py-3">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {b.service.name} <span className="font-mono text-meta font-normal text-ink-muted">{b.publicReference}</span>
                  </p>
                  <p className="text-meta text-ink-muted">{formatInZone(b.slot.startAt, "EEE d MMM yyyy, HH:mm", timeZone)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <BookingStatusBadge status={b.status} />
                  <Link href={`/bookings/${b.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                    Details
                  </Link>
                  {b.cancellation.allowed && (
                    <CancelBookingButton
                      booking={{ id: b.id, publicReference: b.publicReference, serviceName: b.service.name, startAt: b.slot.startAt }}
                      timeZone={timeZone}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {!signedIn && (pickAccount || (reply.requiresSignIn && !reply.proposal && !reply.slots?.length)) && (
          <div className="max-w-[28rem] rounded-lg border border-line bg-surface-muted p-4">
            <p className="mb-3 text-meta text-ink-muted">Continue as a demo account (no password). You&rsquo;ll come back to this conversation.</p>
            <AccountPicker compact callbackUrl="/assistant" />
          </div>
        )}

        {reply.suggestions && reply.suggestions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {reply.suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onSuggestion(s)}
                className="rounded-full border border-line bg-surface px-3 py-1 text-meta text-ink-muted transition-colors hover:border-brand-soft hover:text-brand"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
