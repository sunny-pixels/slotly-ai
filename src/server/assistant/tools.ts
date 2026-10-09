import { z } from "zod";
import type { Actor } from "../authz";
import { prisma } from "../db";
import { listServices, getService, type ServiceView } from "../services/catalog";
import { findOpenSlots, getBookableSlot, type OpenSlot } from "../services/availability";
import { getBookingForActor, listCustomerBookings, type BookingView } from "../services/bookings";
import { answerFromKnowledge } from "../rag/generate";
import { retrieve } from "../rag/retrieve";
import { dateKeySchema, idSchema } from "@/lib/validators";

/**
 * The assistant's tool layer. Each tool validates its arguments with Zod and
 * calls the same domain services as the REST API. Tools are read-only:
 * creating or cancelling a booking is never executed here — the assistant
 * returns a proposal and the user's explicit confirmation calls the normal,
 * independently-validated booking API.
 */

const searchServicesArgs = z.object({
  query: z.string().max(200).optional(),
  maxPrice: z.number().int().min(0).max(100000).optional(),
  maxDuration: z.number().int().min(5).max(480).optional(),
});

export async function search_services(args: z.input<typeof searchServicesArgs>): Promise<{
  services: ServiceView[];
  matchedBy: "filters" | "semantic" | "all";
  sources: { documentTitle: string; headingPath: string }[];
}> {
  const a = searchServicesArgs.parse(args);
  const filtered = await listServices({ maxPrice: a.maxPrice, maxDuration: a.maxDuration, pageSize: 20 });

  if (!a.query) return { services: filtered.items, matchedBy: a.maxPrice || a.maxDuration ? "filters" : "all", sources: [] };

  // Semantic match against the service catalogue documents for descriptive preferences
  // ("something to help me relax"), then map passages back to live services by name.
  try {
    const result = await retrieve(a.query, { categories: ["services"], topK: 4 });
    const ranked: ServiceView[] = [];
    for (const chunk of result.relevant) {
      const haystack = chunk.content.toLowerCase();
      for (const s of filtered.items) {
        if (!ranked.includes(s) && haystack.includes(s.name.toLowerCase())) ranked.push(s);
      }
    }
    if (ranked.length > 0) {
      return {
        services: ranked.slice(0, 4),
        matchedBy: "semantic",
        sources: result.relevant.slice(0, 2).map((c) => ({ documentTitle: c.documentTitle, headingPath: c.headingPath })),
      };
    }
  } catch {
    // Retrieval unavailable — fall back to structured filters only.
  }
  return { services: filtered.items, matchedBy: "filters", sources: [] };
}

export async function get_service_details(args: { serviceId: string }): Promise<ServiceView> {
  return getService(idSchema.parse(args.serviceId));
}

const slotArgs = z.object({
  serviceId: idSchema.optional(),
  fromKey: dateKeySchema,
  toKey: dateKeySchema,
  timeFromMinutes: z.number().int().min(0).max(1440).optional(),
  timeToMinutes: z.number().int().min(0).max(1440).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

/** Live availability from PostgreSQL — never from vector search. */
export async function get_available_slots(args: z.input<typeof slotArgs>): Promise<OpenSlot[]> {
  const a = slotArgs.parse(args);
  return findOpenSlots(a);
}

/** Re-checks a single slot right now (used before presenting a booking proposal). */
export async function check_slot(args: { slotId: string }) {
  return getBookableSlot(idSchema.parse(args.slotId));
}

export async function get_my_bookings(actor: Actor): Promise<BookingView[]> {
  const res = await listCustomerBookings(actor, { view: "upcoming", page: 1, pageSize: 10 });
  return res.items;
}

/** Ownership is enforced inside getBookingForActor — a customer can only see their own booking. */
export async function get_booking_details(actor: Actor, reference: string): Promise<BookingView | null> {
  try {
    return await getBookingForActor(actor, reference.trim());
  } catch {
    return null;
  }
}

export async function search_booking_policies(question: string, history: { role: "user" | "assistant"; content: string }[]) {
  return answerFromKnowledge(question, history);
}

export async function listServiceRefs() {
  return prisma.service.findMany({
    where: { isActive: true },
    select: { id: true, name: true, slug: true, category: true },
    orderBy: { name: "asc" },
  });
}
