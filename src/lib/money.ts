/** Store currency. Prices are stored in minor units (paise for INR). */
export const DEFAULT_CURRENCY = "INR";

const LOCALE_BY_CURRENCY: Record<string, string> = { INR: "en-IN", GBP: "en-GB", USD: "en-US", EUR: "en-IE" };

/** "₹2,500", "₹1,50,000" (Indian digit grouping for INR); minor units shown only when non-zero. */
export function formatPrice(minorUnits: number, currency: string = DEFAULT_CURRENCY): string {
  return new Intl.NumberFormat(LOCALE_BY_CURRENCY[currency] ?? "en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: minorUnits % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(minorUnits / 100);
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
