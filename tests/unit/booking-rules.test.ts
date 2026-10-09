import { describe, expect, it } from "vitest";
import { cancellationEligibility, generateBookingReference, slotState } from "@/lib/booking-rules";

const now = new Date("2026-10-09T12:00:00Z");
const hours = (h: number) => new Date(now.getTime() + h * 3_600_000);

describe("cancellationEligibility", () => {
  it("allows customers to cancel outside the cut-off window", () => {
    expect(cancellationEligibility({ status: "CONFIRMED", startAt: hours(30), now, cutoffHours: 24, actorIsAdmin: false })).toEqual({ ok: true });
  });

  it("blocks customers inside the cut-off window", () => {
    const r = cancellationEligibility({ status: "CONFIRMED", startAt: hours(10), now, cutoffHours: 24, actorIsAdmin: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("CANCELLATION_WINDOW_CLOSED");
  });

  it("blocks customers once the appointment has started", () => {
    const r = cancellationEligibility({ status: "CONFIRMED", startAt: hours(-1), now, cutoffHours: 24, actorIsAdmin: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("STARTED");
  });

  it("lets administrators cancel at any time", () => {
    expect(cancellationEligibility({ status: "CONFIRMED", startAt: hours(1), now, cutoffHours: 24, actorIsAdmin: true })).toEqual({ ok: true });
  });

  it("never re-cancels cancelled or completed bookings", () => {
    expect(cancellationEligibility({ status: "CANCELLED", startAt: hours(48), now, cutoffHours: 24, actorIsAdmin: true }).ok).toBe(false);
    expect(cancellationEligibility({ status: "COMPLETED", startAt: hours(-48), now, cutoffHours: 24, actorIsAdmin: true }).ok).toBe(false);
  });
});

describe("slotState", () => {
  const base = { status: "AVAILABLE" as const, hasActiveBooking: false, now, minLeadMinutes: 60 };
  it("marks future, unbooked slots as available", () => expect(slotState({ ...base, startAt: hours(3) })).toBe("available"));
  it("marks booked slots as booked even when blocked", () =>
    expect(slotState({ ...base, status: "BLOCKED", hasActiveBooking: true, startAt: hours(3) })).toBe("booked"));
  it("marks blocked slots", () => expect(slotState({ ...base, status: "BLOCKED", startAt: hours(3) })).toBe("blocked"));
  it("closes slots inside the minimum lead time and in the past", () => {
    expect(slotState({ ...base, startAt: hours(0.5) })).toBe("closed");
    expect(slotState({ ...base, startAt: hours(-2) })).toBe("closed");
  });
});

describe("generateBookingReference", () => {
  it("produces SLT- plus six unambiguous characters", () => {
    let i = 0;
    const ref = generateBookingReference(() => i++ % 32);
    expect(ref).toMatch(/^SLT-[A-HJ-NP-Z2-9]{6}$/);
  });
});
