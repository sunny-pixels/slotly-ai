"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarDays, Clock3, ReceiptText } from "lucide-react";
import type { BookingView } from "@/server/services/bookings";
import { api, ApiError } from "@/lib/api-client";
import { formatDuration, formatPrice } from "@/lib/money";
import { formatInZone, zoneLabel } from "@/lib/time";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/common/status";

export type BookableSlot = { id: string; startAt: string; endAt: string };
export type BookableService = { name: string; durationMinutes: number; priceCents: number; currency: string };

/**
 * Final confirmation step. Nothing is booked until "Confirm booking" is pressed,
 * and success is only shown after the API returns 201 (i.e. after commit).
 * A 409 means someone else won the slot — it is never presented as confirmed.
 */
export function ConfirmBookingDialog({
  open,
  onOpenChange,
  slot,
  service,
  timeZone,
  cutoffHours,
  defaultNotes = "",
  onBooked,
  onConflict,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slot: BookableSlot | null;
  service: BookableService | null;
  timeZone: string;
  cutoffHours: number;
  defaultNotes?: string;
  onBooked: (booking: BookingView) => void;
  onConflict?: (message: string) => void;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState(defaultNotes);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!slot || !service) return null;

  async function confirm() {
    if (!slot) return;
    setSubmitting(true);
    setError(null);
    try {
      const { booking } = await api<{ booking: BookingView }>("/api/bookings", {
        method: "POST",
        json: { slotId: slot.id, ...(notes.trim() ? { notes: notes.trim() } : {}) },
      });
      toast.success("Booking confirmed", { description: `Reference ${booking.publicReference}` });
      onOpenChange(false);
      onBooked(booking);
      router.refresh();
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError("Something went wrong.", 0, "UNKNOWN");
      if (err.status === 401) {
        toast.error("You're signed out", { description: "Choose a demo account from the sidebar, then confirm again." });
        onOpenChange(false);
        router.refresh();
        return;
      }
      if (err.status === 409) {
        toast.error("That time was just taken", { description: "Someone else confirmed it a moment ago. Please choose another time." });
        onOpenChange(false);
        onConflict?.(err.message);
        return;
      }
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Confirm your booking</DialogTitle>
          <DialogDescription>Check the details below. Your booking is made only when you confirm.</DialogDescription>
        </DialogHeader>

        <div className="rounded-md border border-line bg-surface-muted">
          <div className="border-b border-line px-4 py-3">
            <p className="font-display text-card-title font-semibold">{service.name}</p>
          </div>
          <ul className="grid gap-2.5 px-4 py-3 text-[0.875rem]">
            <li className="flex items-center gap-2.5">
              <CalendarDays className="size-4 text-ink-muted" aria-hidden />
              {formatInZone(slot.startAt, "EEEE d MMMM yyyy", timeZone)}
            </li>
            <li className="flex items-center gap-2.5">
              <Clock3 className="size-4 text-ink-muted" aria-hidden />
              <span className="tabular">
                {formatInZone(slot.startAt, "HH:mm", timeZone)}–{formatInZone(slot.endAt, "HH:mm", timeZone)}
              </span>
              <span className="text-ink-muted">
                ({formatDuration(service.durationMinutes)}, {zoneLabel(slot.startAt, timeZone)})
              </span>
            </li>
            <li className="flex items-center gap-2.5">
              <ReceiptText className="size-4 text-ink-muted" aria-hidden />
              <span className="font-semibold">{formatPrice(service.priceCents, service.currency)}</span>
              <span className="text-ink-muted">paid at the studio</span>
            </li>
          </ul>
        </div>

        <Field id="booking-notes" label="Notes for your practitioner (optional)" hint="Injuries, access needs, or a request for a video call.">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} rows={3} />
        </Field>

        <p className="text-meta text-ink-muted">
          Free cancellation up to {cutoffHours} hours before the start time from My bookings.
        </p>

        {error && <Notice tone="danger" title="Booking not completed">{error}</Notice>}

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={submitting}>
            Back
          </Button>
          <Button onClick={confirm} loading={submitting}>
            {submitting ? "Confirming…" : "Confirm booking"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
