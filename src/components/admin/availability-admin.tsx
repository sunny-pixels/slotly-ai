"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Lock, LockOpen, Plus, Trash2, Wand2 } from "lucide-react";
import { api, ApiError } from "@/lib/api-client";
import { formatInZone } from "@/lib/time";
import { formatDuration } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, Input, NativeSelect } from "@/components/ui/field";
import { Table, TableFrame, TD, TH, THead, TR } from "@/components/ui/data";
import { Notice } from "@/components/common/status";
import { SectionHeader } from "@/components/common/page";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Rule = {
  id: string;
  weekday: number;
  openTime: string;
  closeTime: string;
  slotIntervalMinutes: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
};
type AdminSlot = {
  id: string;
  startAt: string;
  endAt: string;
  status: "AVAILABLE" | "BLOCKED";
  booking: { id: string; reference: string; customerName: string } | null;
};

const dayLabel = (key: string, pattern: string) => formatInZone(`${key}T12:00:00Z`, pattern, "UTC");

export function AvailabilityAdmin({
  services,
  service,
  rules,
  slots,
  from,
  today,
  prevWeek,
  nextWeek,
  days,
  timeZone,
}: {
  services: { id: string; name: string; durationMinutes: number; isActive: boolean }[];
  service: { id: string; name: string; durationMinutes: number; isActive: boolean };
  rules: Rule[];
  slots: AdminSlot[];
  from: string;
  today: string;
  prevWeek: string;
  nextWeek: string;
  days: string[];
  timeZone: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [ruleError, setRuleError] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  async function run<T>(key: string, fn: () => Promise<T>, success: (r: T) => string, onError?: (m: string) => void) {
    setBusy(key);
    try {
      const r = await fn();
      toast.success(success(r));
      router.refresh();
      return true;
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Something went wrong.";
      if (onError) onError(msg);
      else toast.error(msg);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function addRule(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setRuleError(null);
    const ok = await run(
      "rule",
      () =>
        api("/api/admin/availability", {
          method: "POST",
          json: {
            serviceId: service.id,
            weekday: Number(fd.get("weekday")),
            openTime: fd.get("openTime"),
            closeTime: fd.get("closeTime"),
            slotIntervalMinutes: Number(fd.get("interval")),
          },
        }),
      () => "Opening hours added",
      setRuleError,
    );
    if (ok) form.reset();
  }

  async function generate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setGenError(null);
    await run(
      "generate",
      () => api<{ created: number; considered: number }>("/api/admin/slots", { method: "POST", json: { serviceId: service.id, from: fd.get("from"), to: fd.get("to") } }),
      (r) => (r.created ? `Created ${r.created} new slot${r.created === 1 ? "" : "s"}` : `No new slots — all ${r.considered} already exist`),
      setGenError,
    );
  }

  const byDay = new Map<string, AdminSlot[]>(days.map((d) => [d, []]));
  for (const s of slots) {
    const key = formatInZone(s.startAt, "yyyy-MM-dd", timeZone);
    byDay.get(key)?.push(s);
  }

  return (
    <div className="flex flex-col gap-(--section-gap)">
      {/* Service picker */}
      <nav aria-label="Service" className="flex flex-wrap gap-2">
        {services.map((s) => (
          <Link
            key={s.id}
            href={`/admin/availability?serviceId=${s.id}&from=${from}`}
            aria-current={s.id === service.id ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-meta font-medium transition-colors",
              s.id === service.id ? "border-brand bg-brand text-white" : "border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink",
              !s.isActive && "opacity-60",
            )}
          >
            {s.name}
            {!s.isActive && " (inactive)"}
          </Link>
        ))}
      </nav>

      <div className="grid gap-(--section-gap) 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Opening hours */}
        <section aria-labelledby="rules" className="flex flex-col gap-4">
          <SectionHeader id="rules" title="Opening hours" description={`${service.name} · ${formatDuration(service.durationMinutes)} appointments`} />
          {rules.length === 0 ? (
            <Notice tone="warning" title="No opening hours">
              Add at least one weekly rule before generating slots.
            </Notice>
          ) : (
            <TableFrame>
              <Table>
                <THead>
                  <tr>
                    <TH>Day</TH>
                    <TH>Hours</TH>
                    <TH>Slot every</TH>
                    <TH className="text-right">
                      <span className="sr-only">Actions</span>
                    </TH>
                  </tr>
                </THead>
                <tbody>
                  {rules.map((r) => (
                    <TR key={r.id}>
                      <TD className="font-medium">{WEEKDAYS[r.weekday]}</TD>
                      <TD className="tabular">
                        {r.openTime}–{r.closeTime}
                      </TD>
                      <TD>{formatDuration(r.slotIntervalMinutes)}</TD>
                      <TD className="text-right">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove ${WEEKDAYS[r.weekday]} ${r.openTime}–${r.closeTime}`}
                          loading={busy === r.id}
                          onClick={() =>
                            void run(r.id, () => api(`/api/admin/availability/${r.id}`, { method: "DELETE" }), () => "Rule removed (existing slots are unchanged)")
                          }
                        >
                          {busy !== r.id && <Trash2 />}
                        </Button>
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </TableFrame>
          )}
          <form onSubmit={addRule} className="grid gap-3 rounded-lg bg-canvas-sunken/70 p-4 sm:grid-cols-2 xl:grid-cols-[1.3fr_1fr_1fr_1fr_auto] xl:items-end">
            <Field id="rule-weekday" label="Day">
              <NativeSelect name="weekday" defaultValue="1">
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="rule-open" label="Opens">
              <Input name="openTime" type="time" defaultValue="09:00" required />
            </Field>
            <Field id="rule-close" label="Closes">
              <Input name="closeTime" type="time" defaultValue="17:00" required />
            </Field>
            <Field id="rule-interval" label="Every (min)">
              <Input name="interval" type="number" min={5} max={480} step={5} defaultValue={Math.max(service.durationMinutes, 30)} required />
            </Field>
            <Button type="submit" variant="secondary" loading={busy === "rule"}>
              <Plus /> Add
            </Button>
            {ruleError && (
              <Notice tone="danger" className="sm:col-span-2 xl:col-span-5">
                {ruleError}
              </Notice>
            )}
          </form>
        </section>

        {/* Slot generation */}
        <section aria-labelledby="generate" className="flex flex-col gap-4">
          <SectionHeader
            id="generate"
            title="Generate slots"
            description="Creates slots inside the opening hours. Safe to repeat — existing and overlapping slots are skipped."
          />
          <form onSubmit={generate} className="grid gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field id="gen-from" label="From">
              <Input name="from" type="date" defaultValue={today} min={today} required />
            </Field>
            <Field id="gen-to" label="To">
              <Input name="to" type="date" defaultValue={days[6]} min={today} required />
            </Field>
            <Button type="submit" loading={busy === "generate"} disabled={rules.length === 0 || !service.isActive}>
              <Wand2 /> Generate
            </Button>
            {!service.isActive && <p className="text-meta text-ink-muted sm:col-span-3">Activate this service before generating slots.</p>}
            {genError && (
              <Notice tone="danger" className="sm:col-span-3">
                {genError}
              </Notice>
            )}
          </form>
        </section>
      </div>

      {/* Week grid */}
      <section aria-labelledby="week" className="flex flex-col gap-4">
        <SectionHeader
          id="week"
          title="Slots this week"
          description="Select an open slot to block it, or a blocked slot to re-open it. Booked slots must be cancelled first."
          actions={
            <div className="flex items-center gap-1">
              <Link
                href={`/admin/availability?serviceId=${service.id}&from=${prevWeek}`}
                className={buttonVariants({ variant: "secondary", size: "icon-sm" })}
                aria-label="Previous week"
              >
                <ChevronLeft />
              </Link>
              <span className="px-2 text-meta font-medium tabular">
                {dayLabel(days[0], "d MMM")} – {dayLabel(days[6], "d MMM")}
              </span>
              <Link
                href={`/admin/availability?serviceId=${service.id}&from=${nextWeek}`}
                className={buttonVariants({ variant: "secondary", size: "icon-sm" })}
                aria-label="Next week"
              >
                <ChevronRight />
              </Link>
            </div>
          }
        />
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
          {days.map((d) => {
            const daySlots = byDay.get(d) ?? [];
            return (
              <div key={d} className={cn("flex min-h-40 flex-col bg-surface", d === today && "bg-accent-faint/40")}>
                <div className="flex items-baseline justify-between border-b border-line px-3 py-2">
                  <p className="text-[0.8125rem] font-semibold">{dayLabel(d, "EEE d MMM")}</p>
                  <p className="text-[0.6875rem] text-ink-subtle tabular">{daySlots.length} slots</p>
                </div>
                <ul className="flex flex-1 flex-col gap-1 p-2">
                  {daySlots.length === 0 && <li className="px-1 py-2 text-[0.75rem] text-ink-subtle">No slots</li>}
                  {daySlots.map((s) => {
                    const time = `${formatInZone(s.startAt, "HH:mm", timeZone)}–${formatInZone(s.endAt, "HH:mm", timeZone)}`;
                    if (s.booking) {
                      return (
                        <li key={s.id} className="rounded-sm bg-brand px-2 py-1 text-[0.75rem] text-white" title={`${s.booking.reference} · ${s.booking.customerName}`}>
                          <span className="font-semibold tabular">{time}</span>
                          <span className="block truncate text-white/75">{s.booking.customerName}</span>
                        </li>
                      );
                    }
                    const blocked = s.status === "BLOCKED";
                    return (
                      <li key={s.id}>
                        <button
                          type="button"
                          disabled={busy === s.id}
                          onClick={() =>
                            void run(
                              s.id,
                              () => api(`/api/admin/slots/${s.id}`, { method: "PATCH", json: { status: blocked ? "AVAILABLE" : "BLOCKED" } }),
                              () => (blocked ? `Re-opened ${time}` : `Blocked ${time}`),
                            )
                          }
                          className={cn(
                            "flex w-full items-center justify-between gap-1 rounded-sm px-2 py-1 text-left text-[0.75rem] tabular transition-colors disabled:opacity-50",
                            blocked
                              ? "border border-dashed border-line-strong text-ink-subtle line-through hover:border-ink-muted"
                              : "bg-accent-faint text-brand hover:bg-accent-soft",
                          )}
                          aria-label={`${blocked ? "Re-open" : "Block"} ${dayLabel(d, "EEEE d MMMM")} ${time}`}
                        >
                          {time}
                          {blocked ? <LockOpen className="size-3 shrink-0 no-underline" /> : <Lock className="size-3 shrink-0 opacity-40" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
        <p className="flex flex-wrap gap-4 text-[0.75rem] text-ink-muted" aria-hidden>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-accent-faint ring-1 ring-accent" /> Open
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-brand" /> Booked
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm border border-dashed border-line-strong" /> Blocked
          </span>
        </p>
      </section>
    </div>
  );
}
