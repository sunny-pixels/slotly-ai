/**
 * Pure business rules shared by the server (authoritative) and the UI (to
 * explain why an action is unavailable). The server always re-checks.
 */

export const ACTIVE_BOOKING_STATUSES = ["PENDING", "CONFIRMED"] as const;
export type BookingStatusValue = "PENDING" | "CONFIRMED" | "CANCELLED" | "COMPLETED";

export function isActiveStatus(status: BookingStatusValue): boolean {
  return (ACTIVE_BOOKING_STATUSES as readonly string[]).includes(status);
}

export type Eligibility = { ok: true } | { ok: false; code: string; reason: string };

export function cancellationEligibility(args: {
  status: BookingStatusValue;
  startAt: Date;
  now: Date;
  cutoffHours: number;
  actorIsAdmin: boolean;
}): Eligibility {
  const { status, startAt, now, cutoffHours, actorIsAdmin } = args;
  if (status === "CANCELLED") return { ok: false, code: "ALREADY_CANCELLED", reason: "This booking is already cancelled." };
  if (status === "COMPLETED") return { ok: false, code: "COMPLETED", reason: "Completed appointments cannot be cancelled." };
  if (actorIsAdmin) return { ok: true };
  if (startAt.getTime() <= now.getTime()) {
    return { ok: false, code: "STARTED", reason: "This appointment has already started." };
  }
  const hoursUntilStart = (startAt.getTime() - now.getTime()) / 3_600_000;
  if (hoursUntilStart < cutoffHours) {
    return {
      ok: false,
      code: "CANCELLATION_WINDOW_CLOSED",
      reason: `Online cancellation closes ${cutoffHours} hours before the appointment. Please contact the studio for late changes.`,
    };
  }
  return { ok: true };
}

export type SlotState = "available" | "booked" | "blocked" | "closed";

/** "closed" = in the past or inside the minimum booking lead time. */
export function slotState(args: {
  status: "AVAILABLE" | "BLOCKED";
  hasActiveBooking: boolean;
  startAt: Date;
  now: Date;
  minLeadMinutes: number;
}): SlotState {
  if (args.hasActiveBooking) return "booked";
  if (args.status === "BLOCKED") return "blocked";
  if (args.startAt.getTime() < args.now.getTime() + args.minLeadMinutes * 60_000) return "closed";
  return "available";
}

const REFERENCE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I

export function generateBookingReference(random: (max: number) => number): string {
  let out = "SLT-";
  for (let i = 0; i < 6; i++) out += REFERENCE_ALPHABET[random(REFERENCE_ALPHABET.length)];
  return out;
}
