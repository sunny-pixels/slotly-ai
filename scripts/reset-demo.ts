/**
 * pnpm db:reset-demo --yes
 *
 * Wipes demo *activity* so `pnpm db:seed` can rebuild it from scratch: bookings,
 * slots, opening-hour rules, demo users and assistant logs. Services (and their
 * prices) and the knowledge base are kept.
 *
 * Use after changing BUSINESS_TIMEZONE (existing slots were generated for the old
 * zone) or to restore a clean demo. Never run this against real customer data.
 */
import "dotenv/config";
import { prisma } from "../src/server/db";

async function main() {
  if (!process.argv.includes("--yes")) {
    console.error("This deletes ALL bookings, slots, opening-hour rules and users. Re-run with --yes to confirm.");
    process.exitCode = 1;
    return;
  }
  const before = {
    bookings: await prisma.booking.count(),
    slots: await prisma.slot.count(),
    rules: await prisma.availabilityRule.count(),
    users: await prisma.user.count(),
  };
  await prisma.$transaction([
    prisma.assistantLog.deleteMany(),
    prisma.booking.deleteMany(),
    prisma.slot.deleteMany(),
    prisma.availabilityRule.deleteMany(),
    prisma.user.deleteMany(),
  ]);
  console.log(`Deleted ${before.bookings} bookings, ${before.slots} slots, ${before.rules} rules, ${before.users} users.`);
  console.log("Kept services and the knowledge base. Now run: pnpm db:seed");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
