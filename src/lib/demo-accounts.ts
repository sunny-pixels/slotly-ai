/**
 * Demo identities offered by the "Continue as…" switcher. Only these keys can
 * be used to start a session — the client never supplies an email or user id.
 * Emails must match the seeded users (prisma/seed.ts).
 */
export const DEMO_ACCOUNTS = [
  { key: "maya", name: "Maya Chen", role: "CUSTOMER", description: "Customer with upcoming, past and cancelled bookings" },
  { key: "sam", name: "Sam Okafor", role: "CUSTOMER", description: "A second customer — useful for testing ownership" },
  { key: "admin", name: "Ava Patel", role: "ADMIN", description: "Studio administrator" },
] as const;

export type DemoAccountKey = (typeof DEMO_ACCOUNTS)[number]["key"];

export function demoAccountEmail(key: DemoAccountKey): string {
  switch (key) {
    case "maya":
      return process.env.SEED_CUSTOMER_EMAIL ?? "maya@slotly.dev";
    case "sam":
      return process.env.SEED_SECOND_CUSTOMER_EMAIL ?? "sam@slotly.dev";
    case "admin":
      return process.env.SEED_ADMIN_EMAIL ?? "admin@slotly.dev";
  }
}

export function isDemoAccountKey(v: unknown): v is DemoAccountKey {
  return DEMO_ACCOUNTS.some((a) => a.key === v);
}

/** Server-only check. Disable in any deployment that holds real data. */
export function demoAccountsEnabled(): boolean {
  return (process.env.DEMO_ACCOUNTS_ENABLED ?? "true").toLowerCase() === "true";
}
