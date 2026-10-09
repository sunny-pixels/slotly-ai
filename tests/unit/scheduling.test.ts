import { describe, expect, it } from "vitest";
import { buildSlotCandidates } from "@/server/services/scheduling";
import { dayRange, formatInZone, zonedTime } from "@/lib/time";

const TZ = "Europe/London";
const rule = (weekday: number, openTime = "09:00", closeTime = "12:00", slotIntervalMinutes = 60) => ({
  weekday,
  openTime,
  closeTime,
  slotIntervalMinutes,
  effectiveFrom: null,
  effectiveTo: null,
});

describe("buildSlotCandidates", () => {
  const now = new Date("2026-10-01T00:00:00Z");

  it("creates slots that fit entirely inside the opening hours", () => {
    // Monday 12 Oct 2026, 09:00–12:00, 50-minute service every 60 minutes → 09:00, 10:00, 11:00
    const slots = buildSlotCandidates({ rules: [rule(1, "09:00", "12:00", 60)], durationMinutes: 50, fromKey: "2026-10-12", days: 1, tz: TZ, now });
    expect(slots.map((s) => formatInZone(s.startAt, "HH:mm", TZ))).toEqual(["09:00", "10:00", "11:00"]);
    for (const s of slots) expect(s.endAt.getTime() - s.startAt.getTime()).toBe(50 * 60_000);
  });

  it("drops a final slot that would run past closing time", () => {
    const slots = buildSlotCandidates({ rules: [rule(1, "09:00", "11:30", 60)], durationMinutes: 60, fromKey: "2026-10-12", days: 1, tz: TZ, now });
    expect(slots.map((s) => formatInZone(s.startAt, "HH:mm", TZ))).toEqual(["09:00", "10:00"]);
  });

  it("only uses rules for matching weekdays", () => {
    const slots = buildSlotCandidates({ rules: [rule(2)], durationMinutes: 60, fromKey: "2026-10-12", days: 7, tz: TZ, now });
    expect(new Set(slots.map((s) => formatInZone(s.startAt, "EEE", TZ)))).toEqual(new Set(["Tue"]));
  });

  it("respects effective date ranges", () => {
    const limited = { ...rule(1), effectiveFrom: new Date("2026-10-19T00:00:00Z"), effectiveTo: null };
    const slots = buildSlotCandidates({ rules: [limited], durationMinutes: 60, fromKey: "2026-10-12", days: 14, tz: TZ, now });
    expect(slots.every((s) => s.startAt >= dayRange("2026-10-19", TZ).start)).toBe(true);
    expect(slots.length).toBe(3);
  });

  it("never generates slots in the past", () => {
    const later = zonedTime("2026-10-12", "10:30", TZ);
    const slots = buildSlotCandidates({ rules: [rule(1)], durationMinutes: 60, fromKey: "2026-10-12", days: 1, tz: TZ, now: later });
    expect(slots.map((s) => formatInZone(s.startAt, "HH:mm", TZ))).toEqual(["11:00"]);
  });

  it("keeps local wall-clock times across the October DST change", () => {
    // UK clocks go back on Sunday 25 Oct 2026; Monday 26 Oct is GMT.
    const slots = buildSlotCandidates({ rules: [rule(5), rule(1)], durationMinutes: 60, fromKey: "2026-10-23", days: 4, tz: TZ, now });
    const fri = slots.find((s) => formatInZone(s.startAt, "EEE", TZ) === "Fri")!;
    const mon = slots.find((s) => formatInZone(s.startAt, "EEE", TZ) === "Mon")!;
    expect(fri.startAt.toISOString()).toBe("2026-10-23T08:00:00.000Z"); // 09:00 BST
    expect(mon.startAt.toISOString()).toBe("2026-10-26T09:00:00.000Z"); // 09:00 GMT
  });
});
