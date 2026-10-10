import { prisma } from "@/server/db";
import type { Actor } from "@/server/authz";

type TestSession = { user: { id: string; role: "CUSTOMER" | "ADMIN"; name: string; email: string } } | null;

/** Sets the identity returned by the mocked Auth.js `auth()` for subsequent requests. */
export function actAs(user: Actor | null) {
  (globalThis as unknown as { __testSession: TestSession }).__testSession = user
    ? { user: { id: user.id, role: user.role, name: user.name, email: user.email } }
    : null;
}

export async function resetDatabase() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE bookings, slots, availability_rules, services, knowledge_chunks, knowledge_documents, assistant_logs, users RESTART IDENTITY CASCADE`,
  );
}

let counter = 0;
const unique = (p: string) => `${p}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export async function createUser(role: "CUSTOMER" | "ADMIN" = "CUSTOMER", name = "Test User"): Promise<Actor> {
  const email = `${unique(role.toLowerCase())}@test.slotly`;
  return prisma.user.create({ data: { email, name, role }, select: { id: true, name: true, email: true, role: true } });
}

export async function createService(overrides: Partial<{ name: string; slug: string; priceCents: number; durationMinutes: number; isActive: boolean; category: string }> = {}) {
  return prisma.service.create({
    data: {
      name: overrides.name ?? "Test Massage",
      slug: overrides.slug ?? unique("svc"),
      description: "A service used by the automated test suite.",
      category: overrides.category ?? "Wellness",
      durationMinutes: overrides.durationMinutes ?? 60,
      priceCents: overrides.priceCents ?? 6500,
      currency: "INR",
      isActive: overrides.isActive ?? true,
    },
  });
}

/** Creates a slot starting `hoursFromNow` hours from now (negative = past). */
export async function createSlot(serviceId: string, hoursFromNow: number, opts: { durationMinutes?: number; status?: "AVAILABLE" | "BLOCKED" } = {}) {
  const start = new Date(Date.now() + hoursFromNow * 3_600_000);
  start.setUTCSeconds(0, 0);
  start.setUTCMinutes(0);
  return prisma.slot.create({
    data: {
      serviceId,
      startAt: start,
      endAt: new Date(start.getTime() + (opts.durationMinutes ?? 60) * 60_000),
      status: opts.status ?? "AVAILABLE",
    },
  });
}

export function jsonRequest(url: string, method: string, body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });
}

export const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
