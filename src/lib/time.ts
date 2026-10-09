import { TZDate, tz } from "@date-fns/tz";
import { addDays, format, isValid, parse, startOfDay } from "date-fns";

/**
 * All timestamps are stored as UTC `timestamptz`. Business rules (opening
 * hours, "which day is this slot on") are evaluated in the business time zone.
 * These helpers are pure and safe to use on both server and client.
 */

export const DATE_KEY_FORMAT = "yyyy-MM-dd";

/** "2026-10-09" for the given instant, as seen in `timeZone`. */
export function toDateKey(date: Date, timeZone: string): string {
  return format(date, DATE_KEY_FORMAT, { in: tz(timeZone) });
}

export function isDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return isValid(parse(value, DATE_KEY_FORMAT, new Date()));
}

/** UTC instants bounding the business-local calendar day `dateKey` (half-open). */
export function dayRange(dateKey: string, timeZone: string): { start: Date; end: Date } {
  const [y, m, d] = dateKey.split("-").map(Number);
  const start = new TZDate(y, m - 1, d, 0, 0, timeZone);
  const end = addDays(start, 1);
  return { start: new Date(start.getTime()), end: new Date(end.getTime()) };
}

/** The UTC instant for a local wall-clock time ("HH:mm") on `dateKey` in `timeZone`. */
export function zonedTime(dateKey: string, hhmm: string, timeZone: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  return new Date(new TZDate(y, m - 1, d, hh, mm, timeZone).getTime());
}

/** Weekday (0 = Sunday) of a business-local date key. */
export function weekdayOf(dateKey: string, timeZone: string): number {
  return new TZDate(dayRange(dateKey, timeZone).start, timeZone).getDay();
}

export function todayKey(timeZone: string, now: Date = new Date()): string {
  return toDateKey(now, timeZone);
}

export function addDaysToKey(dateKey: string, days: number, timeZone: string): string {
  const { start } = dayRange(dateKey, timeZone);
  return toDateKey(addDays(new TZDate(start, timeZone), days), timeZone);
}

/** Minutes since local midnight for an instant in `timeZone`. */
export function minutesOfDay(date: Date, timeZone: string): number {
  const local = new TZDate(date, timeZone);
  return local.getHours() * 60 + local.getMinutes();
}

export function formatInZone(date: Date | string, pattern: string, timeZone: string): string {
  return format(new Date(date), pattern, { in: tz(timeZone) });
}

export function formatTime(date: Date | string, timeZone: string): string {
  return formatInZone(date, "HH:mm", timeZone);
}

export function formatDate(date: Date | string, timeZone: string): string {
  return formatInZone(date, "EEE d MMM yyyy", timeZone);
}

export function formatDateTime(date: Date | string, timeZone: string): string {
  return formatInZone(date, "EEE d MMM yyyy, HH:mm", timeZone);
}

/** Short zone label such as "GMT+1" for display next to times. */
export function zoneLabel(date: Date | string, timeZone: string): string {
  return formatInZone(date, "zzz", timeZone);
}

export function startOfBusinessDay(date: Date, timeZone: string): Date {
  return new Date(startOfDay(date, { in: tz(timeZone) }).getTime());
}
