/**
 * Idempotent demo seed. Safe to run repeatedly:
 *  - demo users are upserted by email (no passwords — see src/lib/demo-accounts.ts),
 *  - services by slug, availability rules only when a service has none,
 *  - slots via the same generator the admin UI uses (ON CONFLICT DO NOTHING),
 *  - demo bookings by fixed public reference,
 *  - knowledge documents by slug + content hash (unchanged docs are not re-embedded).
 *
 * All data is fictional demonstration data.
 */
import "dotenv/config";
import { prisma } from "../src/server/db";
import { demoAccountEmail } from "../src/lib/demo-accounts";
import { generateSlots } from "../src/server/services/scheduling";
import { ingestKnowledgeDirectory } from "../src/server/rag/knowledge-files";
import { getConfig } from "../src/lib/config";
import { addDaysToKey, dayRange, todayKey, zonedTime } from "../src/lib/time";

const SERVICES = [
  {
    slug: "strategy-consultation",
    name: "Strategy Consultation",
    category: "Consultations",
    durationMinutes: 60,
    priceCents: 9500,
    description:
      "A focused one-to-one session with a senior business strategist. Bring a challenge — a launch, pricing, hiring or fundraising — and leave with a prioritised action plan.",
    rules: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, openTime: "09:00", closeTime: "17:00", slotIntervalMinutes: 60 })),
  },
  {
    slug: "career-coaching",
    name: "Career Coaching",
    category: "Coaching",
    durationMinutes: 45,
    priceCents: 7000,
    description:
      "Practical coaching for career changes, promotions and job searches: CV and LinkedIn reviews, interview practice, salary negotiation and planning your next move.",
    rules: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, openTime: "10:00", closeTime: "18:00", slotIntervalMinutes: 60 })),
  },
  {
    slug: "deep-tissue-massage",
    name: "Deep Tissue Massage",
    category: "Wellness",
    durationMinutes: 60,
    priceCents: 6500,
    description:
      "Firm-pressure massage targeting chronic tension and knots in the back, neck and shoulders. Ideal for desk workers, regular trainers, and anyone carrying stress physically.",
    rules: [
      ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday, openTime: "09:00", closeTime: "18:00", slotIntervalMinutes: 75 })),
      { weekday: 6, openTime: "10:00", closeTime: "14:00", slotIntervalMinutes: 75 },
    ],
  },
  {
    slug: "guided-meditation",
    name: "Guided Meditation",
    category: "Wellness",
    durationMinutes: 30,
    priceCents: 2500,
    description:
      "A calm, beginner-friendly session of guided breathing and mindfulness to help with stress, anxiety or poor sleep. No experience needed.",
    rules: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, openTime: "09:00", closeTime: "18:00", slotIntervalMinutes: 45 })),
  },
  {
    slug: "nutrition-assessment",
    name: "Nutrition Assessment",
    category: "Health",
    durationMinutes: 50,
    priceCents: 5500,
    description:
      "A registered nutritionist reviews your eating habits, energy and goals, then builds a realistic meal plan for weight, performance or digestive comfort.",
    rules: [2, 4].map((weekday) => ({ weekday, openTime: "09:00", closeTime: "17:00", slotIntervalMinutes: 60 })),
  },
  {
    slug: "physio-check-in",
    name: "Physio Check-in",
    category: "Health",
    durationMinutes: 30,
    priceCents: 4500,
    description:
      "A short physiotherapy assessment for aches, minor sports injuries or back pain, with hands-on treatment where appropriate and exercises to continue at home.",
    rules: [
      ...[1, 3, 5].map((weekday) => ({ weekday, openTime: "09:00", closeTime: "18:00", slotIntervalMinutes: 30 })),
      { weekday: 6, openTime: "10:00", closeTime: "14:00", slotIntervalMinutes: 30 },
    ],
  },
] as const;

const SLOT_DAYS = 14;

/** Demo identities used by the "Continue as…" switcher (src/lib/demo-accounts.ts). */
async function upsertUser(email: string, name: string, role: "ADMIN" | "CUSTOMER") {
  return prisma.user.upsert({ where: { email }, create: { email, name, role }, update: { name, role } });
}

async function main() {
  const { BUSINESS_TIMEZONE: tz } = getConfig();
  const now = new Date();
  console.log(`Seeding Slotly demo data (business time zone ${tz})`);

  // ── Users ──────────────────────────────────────────────────────────────────
  const admin = await upsertUser(demoAccountEmail("admin"), "Ava Patel", "ADMIN");
  const maya = await upsertUser(demoAccountEmail("maya"), "Maya Chen", "CUSTOMER");
  const sam = await upsertUser(demoAccountEmail("sam"), "Sam Okafor", "CUSTOMER");
  console.log(`  users: ${admin.email} (admin), ${maya.email}, ${sam.email}`);

  // ── Services, opening hours, slots ─────────────────────────────────────────
  const today = todayKey(tz, now);
  const lastDay = addDaysToKey(today, SLOT_DAYS - 1, tz);
  const serviceIds: Record<string, string> = {};
  for (const s of SERVICES) {
    const { rules, ...data } = s;
    const service = await prisma.service.upsert({
      where: { slug: s.slug },
      create: { ...data, currency: "GBP" },
      update: {},
    });
    serviceIds[s.slug] = service.id;
    if ((await prisma.availabilityRule.count({ where: { serviceId: service.id } })) === 0) {
      await prisma.availabilityRule.createMany({ data: rules.map((r) => ({ ...r, serviceId: service.id, timezone: tz })) });
    }
    const generated = await generateSlots(service.id, today, lastDay, now);
    console.log(`  ${s.name.padEnd(22)} +${generated.created} slots (${generated.considered} in schedule)`);
  }

  // ── Demo bookings (fixed references → idempotent) ──────────────────────────
  const pickSlot = async (slug: string, daysAhead: number, hhmm?: string) => {
    let day = addDaysToKey(today, daysAhead, tz);
    for (let i = 0; i < 7; i++, day = addDaysToKey(day, 1, tz)) {
      const { start, end } = dayRange(day, tz);
      const slot = await prisma.slot.findFirst({
        where: {
          serviceId: serviceIds[slug],
          status: "AVAILABLE",
          startAt: hhmm ? zonedTime(day, hhmm, tz) : { gte: start, lt: end },
          bookings: { none: { status: { in: ["PENDING", "CONFIRMED"] } } },
        },
        orderBy: { startAt: "asc" },
      });
      if (slot) return slot;
    }
    return null;
  };

  const demoBookings: { ref: string; slug: string; days: number; time?: string; customerId: string; status: "CONFIRMED" | "CANCELLED" }[] = [
    { ref: "SLT-DEMO01", slug: "deep-tissue-massage", days: 3, time: "10:15", customerId: maya.id, status: "CONFIRMED" },
    { ref: "SLT-DEMO02", slug: "physio-check-in", days: 6, customerId: maya.id, status: "CONFIRMED" },
    { ref: "SLT-DEMO03", slug: "strategy-consultation", days: 2, time: "11:00", customerId: maya.id, status: "CANCELLED" },
    { ref: "SLT-DEMO04", slug: "career-coaching", days: 2, time: "14:00", customerId: sam.id, status: "CONFIRMED" },
  ];

  for (const b of demoBookings) {
    if (await prisma.booking.findUnique({ where: { publicReference: b.ref } })) continue;
    const slot = (await pickSlot(b.slug, b.days, b.time)) ?? (await pickSlot(b.slug, b.days));
    if (!slot) continue;
    const service = SERVICES.find((s) => s.slug === b.slug)!;
    await prisma.booking.create({
      data: {
        publicReference: b.ref,
        slotId: slot.id,
        customerId: b.customerId,
        status: b.status,
        priceCents: service.priceCents,
        currency: "GBP",
        ...(b.status === "CANCELLED" ? { cancelledAt: now, cancelledById: b.customerId } : {}),
      },
    });
  }

  // A completed appointment in the past (past slots are never generated, so create one directly).
  if (!(await prisma.booking.findUnique({ where: { publicReference: "SLT-DEMO05" } }))) {
    const pastDay = addDaysToKey(today, -5, tz);
    const startAt = zonedTime(pastDay, "09:00", tz);
    const slot = await prisma.slot.upsert({
      where: { serviceId_startAt: { serviceId: serviceIds["guided-meditation"], startAt } },
      create: { serviceId: serviceIds["guided-meditation"], startAt, endAt: new Date(startAt.getTime() + 30 * 60_000) },
      update: {},
    });
    await prisma.booking.create({
      data: { publicReference: "SLT-DEMO05", slotId: slot.id, customerId: maya.id, status: "COMPLETED", priceCents: 2500, currency: "GBP" },
    });
  }
  console.log(`  bookings: ${await prisma.booking.count()} total`);

  // ── Knowledge base ─────────────────────────────────────────────────────────
  console.log("  knowledge base (first run downloads the local embedding model, ~35 MB):");
  const results = await ingestKnowledgeDirectory({ log: (l) => console.log(`    ${l}`) });
  if (results.some((r) => r.status === "FAILED")) {
    console.warn("  Some documents failed to ingest. Booking still works; fix the error and run `pnpm kb:ingest`.");
  }
  console.log("Done.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
