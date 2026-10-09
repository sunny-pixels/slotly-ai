"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DayPicker } from "react-day-picker";
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Globe2, RefreshCw } from "lucide-react";
import type { BookingView } from "@/server/services/bookings";
import type { DayAvailability, SlotView } from "@/server/services/availability";
import { api, ApiError } from "@/lib/api-client";
import { formatDuration, formatPrice } from "@/lib/money";
import { formatInZone, zoneLabel } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/menu";
import { Skeleton } from "@/components/ui/data";
import { Notice } from "@/components/common/status";
import { AccountPicker } from "@/components/shell/account-picker";
import { ConfirmBookingDialog } from "./confirm-booking-dialog";

type CalendarDay = { date: string; available: number };

type Props = {
  service: { id: string; slug: string; name: string; durationMinutes: number; priceCents: number; currency: string };
  timeZone: string;
  today: string;
  initialDate?: string;
  signedIn: boolean;
  cutoffHours: number;
  info: React.ReactNode;
};

const CALENDAR_DAYS = 21;

function dateFromKey(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function keyFromDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const labelFor = (key: string, pattern: string) => formatInZone(`${key}T12:00:00Z`, pattern, "UTC");

export function BookingWorkspace({ service, timeZone, today, initialDate, signedIn, cutoffHours, info }: Props) {
  const [calendar, setCalendar] = useState<CalendarDay[] | null>(null);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(initialDate ?? null);
  const [day, setDay] = useState<DayAvailability | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [dayFailure, setDayFailure] = useState<{ date: string; message: string } | null>(null);
  const [selected, setSelected] = useState<SlotView | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [booked, setBooked] = useState<BookingView | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [stripOffset, setStripOffset] = useState(0);

  const viewerZone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return timeZone;
    }
  }, [timeZone]);

  // Requests are plain promises; state is only applied when a response arrives, and
  // loading flags are derived from what has loaded rather than toggled in effects.
  const requestCalendar = useCallback(
    () => api<{ days: CalendarDay[] }>(`/api/availability/calendar?serviceId=${service.id}&from=${today}&days=${CALENDAR_DAYS}`),
    [service.id, today],
  );
  const requestDay = useCallback((key: string) => api<DayAvailability>(`/api/availability?serviceId=${service.id}&date=${key}`), [service.id]);

  const applyCalendar = useCallback(
    (res: { days: CalendarDay[] }) => {
      setCalendar(res.days);
      setCalendarError(null);
      setDate((current) => current ?? res.days.find((d) => d.available > 0)?.date ?? today);
    },
    [today],
  );
  const applyDay = useCallback((res: DayAvailability) => {
    setDay(res);
    setDayFailure(null);
    // Drop a selection that is no longer available (e.g. booked by someone else meanwhile).
    setSelected((s) => (s && res.slots.some((x) => x.id === s.id && x.state === "available") ? s : null));
  }, []);
  const calendarFailed = (e: unknown) => setCalendarError(e instanceof ApiError ? e.message : "Couldn't load the calendar.");
  const dayFailed = (key: string, e: unknown) =>
    setDayFailure({ date: key, message: e instanceof ApiError ? e.message : "Couldn't load times for this day." });

  useEffect(() => {
    let cancelled = false;
    requestCalendar().then(
      (res) => !cancelled && applyCalendar(res),
      (e) => !cancelled && calendarFailed(e),
    );
    return () => {
      cancelled = true;
    };
  }, [requestCalendar, applyCalendar]);

  useEffect(() => {
    if (!date) return;
    let cancelled = false;
    requestDay(date).then(
      (res) => !cancelled && applyDay(res),
      (e) => !cancelled && dayFailed(date, e),
    );
    return () => {
      cancelled = true;
    };
  }, [date, requestDay, applyDay]);

  async function fetchDay(key: string) {
    try {
      applyDay(await requestDay(key));
    } catch (e) {
      dayFailed(key, e);
    }
  }
  async function fetchCalendar() {
    try {
      applyCalendar(await requestCalendar());
    } catch (e) {
      calendarFailed(e);
    }
  }

  /** Explicit refresh (retry, after booking, after a conflict) — called from event handlers. */
  async function loadDay(key: string) {
    setRefreshing(true);
    await fetchDay(key);
    setRefreshing(false);
  }
  async function loadCalendar() {
    setCalendarError(null);
    await fetchCalendar();
  }

  const dayError = dayFailure && dayFailure.date === date ? dayFailure.message : null;
  const dayLoading = refreshing || (Boolean(date) && day?.date !== date && !dayError);

  function chooseDate(key: string) {
    setSelected(null);
    setConflict(null);
    setDate(key);
    const url = new URL(window.location.href);
    url.searchParams.set("date", key);
    window.history.replaceState(null, "", url);
  }

  const groups = useMemo(() => {
    const out: { label: string; slots: SlotView[] }[] = [
      { label: "Morning", slots: [] },
      { label: "Afternoon", slots: [] },
      { label: "Evening", slots: [] },
    ];
    for (const s of day?.slots ?? []) {
      const hour = Number(formatInZone(s.startAt, "H", timeZone));
      out[hour < 12 ? 0 : hour < 17 ? 1 : 2].slots.push(s);
    }
    return out.filter((g) => g.slots.length > 0);
  }, [day, timeZone]);

  const availableCount = day?.slots.filter((s) => s.state === "available").length ?? 0;
  const stripDays = calendar?.slice(stripOffset, stripOffset + 7) ?? [];
  const callbackUrl = `/services/${service.slug}/book${date ? `?date=${date}` : ""}`;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,22rem)] lg:items-start 2xl:grid-cols-[minmax(17rem,21rem)_minmax(0,1fr)_minmax(19rem,22rem)] 2xl:gap-8">
      <div className="lg:col-start-2 lg:row-start-2 2xl:col-start-1 2xl:row-start-1 2xl:row-span-2">{info}</div>

      {/* ── Date + time selection ───────────────────────────────────────── */}
      <section aria-labelledby="choose-time" className="flex min-w-0 flex-col gap-5 lg:col-start-1 lg:row-span-2 lg:row-start-1 2xl:col-start-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="choose-time" className="text-section font-semibold">
              Choose a date and time
            </h2>
            <p className="flex items-center gap-1.5 text-meta text-ink-muted">
              <Globe2 className="size-3.5" aria-hidden />
              Times shown in studio time ({timeZone.replace("_", " ")}
              {day?.slots[0] ? `, ${zoneLabel(day.slots[0].startAt, timeZone)}` : ""})
            </p>
          </div>
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button variant="secondary" size="sm" disabled={!calendar}>
                <CalendarDays /> {date ? labelFor(date, "EEE d MMM") : "Pick a date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="p-2">
              {calendar && (
                <DayPicker
                  mode="single"
                  className="slotly-calendar"
                  selected={date ? dateFromKey(date) : undefined}
                  onSelect={(d) => {
                    if (d) {
                      chooseDate(keyFromDate(d));
                      setPickerOpen(false);
                    }
                  }}
                  startMonth={dateFromKey(calendar[0].date)}
                  endMonth={dateFromKey(calendar[calendar.length - 1].date)}
                  disabled={[
                    { before: dateFromKey(calendar[0].date) },
                    { after: dateFromKey(calendar[calendar.length - 1].date) },
                    (d: Date) => (calendar.find((c) => c.date === keyFromDate(d))?.available ?? 0) === 0,
                  ]}
                  weekStartsOn={1}
                  classNames={{
                    root: "text-[0.8125rem]",
                    months: "relative",
                    month_caption: "flex h-9 items-center px-2 font-display font-semibold",
                    nav: "absolute right-0 top-0 flex gap-1",
                    button_previous: "flex size-8 items-center justify-center rounded-md hover:bg-canvas-sunken disabled:opacity-30",
                    button_next: "flex size-8 items-center justify-center rounded-md hover:bg-canvas-sunken disabled:opacity-30",
                    weekday: "size-9 text-[0.6875rem] font-medium uppercase text-ink-subtle",
                    day: "p-0.5",
                    day_button:
                      "size-9 rounded-md tabular hover:bg-accent-faint disabled:cursor-not-allowed disabled:text-ink-subtle/60 disabled:hover:bg-transparent",
                    selected: "[&>button]:bg-brand [&>button]:text-white [&>button]:hover:bg-brand",
                    today: "[&>button]:font-bold [&>button]:underline [&>button]:underline-offset-4",
                    chevron: "size-4 fill-ink-muted",
                  }}
                />
              )}
            </PopoverContent>
          </Popover>
        </div>

        {/* Date strip */}
        {calendarError ? (
          <Notice
            tone="danger"
            title="Calendar unavailable"
            action={
              <Button size="sm" variant="secondary" onClick={() => void loadCalendar()}>
                <RefreshCw /> Retry
              </Button>
            }
          >
            {calendarError}
          </Notice>
        ) : (
          <div className="flex items-stretch gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="h-auto"
              aria-label="Earlier dates"
              disabled={stripOffset === 0}
              onClick={() => setStripOffset((o) => Math.max(0, o - 7))}
            >
              <ChevronLeft />
            </Button>
            <ol className="grid flex-1 grid-cols-7 gap-1.5" aria-label="Dates">
              {calendar
                ? stripDays.map((d) => {
                    const active = d.date === date;
                    return (
                      <li key={d.date}>
                        <button
                          type="button"
                          onClick={() => chooseDate(d.date)}
                          aria-pressed={active}
                          className={cn(
                            "flex w-full flex-col items-center gap-0.5 rounded-md border px-1 py-2.5 transition-colors",
                            active
                              ? "border-brand bg-brand text-white"
                              : d.available > 0
                                ? "border-line bg-surface hover:border-brand-soft"
                                : "border-transparent bg-canvas-sunken/70 text-ink-subtle",
                          )}
                        >
                          <span className="text-[0.6875rem] font-medium uppercase tracking-wide opacity-80">{labelFor(d.date, "EEE")}</span>
                          <span className="font-display text-[1.125rem] font-bold leading-none tabular">{labelFor(d.date, "d")}</span>
                          <span className={cn("text-[0.6875rem]", active ? "text-accent" : d.available > 0 ? "text-success" : "")}>
                            {d.available > 0 ? `${d.available} open` : "None"}
                          </span>
                        </button>
                      </li>
                    );
                  })
                : Array.from({ length: 7 }, (_, i) => (
                    <li key={i}>
                      <Skeleton className="h-[4.25rem]" />
                    </li>
                  ))}
            </ol>
            <Button
              variant="ghost"
              size="icon"
              className="h-auto"
              aria-label="Later dates"
              disabled={!calendar || stripOffset + 7 >= calendar.length}
              onClick={() => setStripOffset((o) => o + 7)}
            >
              <ChevronRight />
            </Button>
          </div>
        )}

        {/* Slots */}
        <div className="rounded-lg border border-line bg-surface p-4 sm:p-5" aria-live="polite" aria-busy={dayLoading}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="font-display text-card-title font-semibold">{date ? labelFor(date, "EEEE d MMMM") : "Loading…"}</p>
            <div className="flex flex-wrap items-center gap-3 text-[0.75rem] text-ink-muted" aria-hidden>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm border border-brand-soft bg-surface" /> Open
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm bg-canvas-sunken" /> Booked
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm border border-dashed border-line-strong" /> Unavailable
              </span>
            </div>
          </div>

          {conflict && (
            <Notice tone="warning" title="That time is no longer available" className="mb-4">
              {conflict} The times below have been refreshed.
            </Notice>
          )}

          {dayError ? (
            <Notice
              tone="danger"
              title="Couldn't load times"
              action={
                <Button size="sm" variant="secondary" onClick={() => date && void loadDay(date)}>
                  <RefreshCw /> Retry
                </Button>
              }
            >
              {dayError}
            </Notice>
          ) : dayLoading && day?.date !== date ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2">
              {Array.from({ length: 10 }, (_, i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : groups.length === 0 ? (
            <p className="py-8 text-center text-meta text-ink-muted">
              No appointments are scheduled on this day. Choose another date{calendar?.some((c) => c.available > 0) ? " with open times" : ""}.
            </p>
          ) : (
            <div className={cn("flex flex-col gap-5 transition-opacity", dayLoading && "opacity-60")}>
              {availableCount === 0 && (
                <p className="text-meta text-ink-muted">Every time on this day is taken or unavailable — try another date.</p>
              )}
              {groups.map((g) => (
                <fieldset key={g.label} className="flex flex-col gap-2">
                  <legend className="mb-2 text-label font-semibold uppercase text-ink-subtle">{g.label}</legend>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2">
                    {g.slots.map((s) => {
                      const isSelected = selected?.id === s.id;
                      const time = formatInZone(s.startAt, "HH:mm", timeZone);
                      if (s.state !== "available") {
                        return (
                          <span
                            key={s.id}
                            className={cn(
                              "flex h-10 flex-col items-center justify-center rounded-md text-[0.8125rem] tabular text-ink-subtle",
                              s.state === "booked" ? "bg-canvas-sunken line-through decoration-ink-subtle/60" : "border border-dashed border-line-strong",
                            )}
                            title={s.state === "booked" ? "Already booked" : "Not bookable"}
                          >
                            {time}
                            <span className="sr-only">{s.state === "booked" ? " — booked" : " — unavailable"}</span>
                          </span>
                        );
                      }
                      return (
                        <button
                          key={s.id}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => {
                            setSelected(isSelected ? null : s);
                            setConflict(null);
                          }}
                          className={cn(
                            "h-10 rounded-md border text-[0.875rem] font-semibold tabular transition-colors",
                            isSelected
                              ? "border-brand bg-brand text-white"
                              : "border-brand-soft/40 bg-surface text-brand hover:border-brand hover:bg-accent-faint",
                          )}
                        >
                          {time}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ── Summary ─────────────────────────────────────────────────────── */}
      <aside aria-labelledby="summary-heading" className="lg:col-start-2 lg:row-start-1 2xl:sticky 2xl:top-6 2xl:col-start-3 2xl:row-span-2 2xl:self-start">
        {booked ? (
          <div className="rounded-lg border border-success/30 bg-surface p-5">
            <CheckCircle2 className="size-8 text-success" aria-hidden />
            <h2 id="summary-heading" className="mt-3 text-section font-semibold">
              You&rsquo;re booked
            </h2>
            <p className="mt-1 text-meta text-ink-muted">
              {booked.service.name} on {formatInZone(booked.slot.startAt, "EEEE d MMMM 'at' HH:mm", timeZone)}.
            </p>
            <p className="mt-4 text-label font-semibold uppercase text-ink-subtle">Reference</p>
            <p className="font-display text-[1.25rem] font-bold tracking-wide">{booked.publicReference}</p>
            <div className="mt-5 flex flex-col gap-2">
              <Link href={`/bookings/${booked.id}`} className={buttonVariants({ variant: "primary" })}>
                View booking
              </Link>
              <Button
                variant="ghost"
                onClick={() => {
                  setBooked(null);
                  setSelected(null);
                }}
              >
                Book another time
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-line bg-surface">
            <div className="border-b border-line px-5 py-4">
              <h2 id="summary-heading" className="text-section font-semibold">
                Booking summary
              </h2>
            </div>
            <dl className="grid gap-3 px-5 py-4 text-[0.875rem]">
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Service</dt>
                <dd className="text-right font-medium">{service.name}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Date</dt>
                <dd className="text-right font-medium">{selected ? formatInZone(selected.startAt, "EEE d MMM yyyy", timeZone) : "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Time</dt>
                <dd className="text-right font-medium tabular">
                  {selected ? `${formatInZone(selected.startAt, "HH:mm", timeZone)}–${formatInZone(selected.endAt, "HH:mm", timeZone)}` : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Duration</dt>
                <dd className="text-right font-medium">{formatDuration(service.durationMinutes)}</dd>
              </div>
              <div className="flex justify-between gap-4 border-t border-line pt-3">
                <dt className="font-medium">Total</dt>
                <dd className="font-display text-[1.125rem] font-bold">{formatPrice(service.priceCents, service.currency)}</dd>
              </div>
            </dl>
            {selected && viewerZone !== timeZone && (
              <p className="mx-5 mb-3 rounded-md bg-info-bg px-3 py-2 text-meta text-info">
                That&rsquo;s {formatInZone(selected.startAt, "HH:mm 'on' EEE d MMM", viewerZone)} in your time zone ({viewerZone.replace("_", " ")}).
              </p>
            )}
            <div className="px-5 pb-5">
              {signedIn ? (
                <Button className="w-full" size="lg" disabled={!selected} onClick={() => setConfirmOpen(true)}>
                  {selected ? "Review and confirm" : "Select a time to continue"}
                </Button>
              ) : (
                <div className="space-y-3">
                  <p className="text-meta text-ink-muted">Choose a demo account to book — no password needed.</p>
                  <AccountPicker compact callbackUrl={callbackUrl} />
                </div>
              )}
              <p className="mt-3 text-center text-[0.75rem] text-ink-muted">Free cancellation up to {cutoffHours} h before · pay at the studio</p>
            </div>
          </div>
        )}
      </aside>

      <ConfirmBookingDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        slot={selected}
        service={service}
        timeZone={timeZone}
        cutoffHours={cutoffHours}
        onBooked={(b) => {
          setBooked(b);
          setSelected(null);
          if (date) void loadDay(date);
          void loadCalendar();
        }}
        onConflict={(message) => {
          setConflict(message);
          setSelected(null);
          if (date) void loadDay(date);
          void loadCalendar();
        }}
      />
    </div>
  );
}
