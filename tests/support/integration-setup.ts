import { afterAll, vi } from "vitest";

/**
 * Route handlers resolve the caller through Auth.js `auth()`. In tests we
 * replace only that function: the session is whatever `actAs()` set, and
 * everything after it (role re-check against the DB, ownership filters,
 * validation, the booking transaction) runs for real.
 */
type TestSession = { user: { id: string; role: "CUSTOMER" | "ADMIN"; name: string; email: string } } | null;

const g = globalThis as unknown as { __testSession: TestSession };
g.__testSession = null;

vi.mock("@/server/auth", () => ({
  auth: vi.fn(async () => (globalThis as unknown as { __testSession: TestSession }).__testSession),
  handlers: { GET: vi.fn(), POST: vi.fn() },
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

// React's `cache` is only meaningful during a server render; in tests make it a pass-through
// so each call re-reads the (mocked) session.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return { ...actual, cache: <T extends (...args: never[]) => unknown>(fn: T) => fn };
});

afterAll(async () => {
  const { prisma } = await import("@/server/db");
  await prisma.$disconnect();
});
