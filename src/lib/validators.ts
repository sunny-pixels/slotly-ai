import { z } from "zod";
import { isDateKey } from "./time";

/** Shared request schemas — used by route handlers (authoritative) and forms (UX only). */

export const idSchema = z.string().trim().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/, "Invalid id");
export const dateKeySchema = z.string().refine(isDateKey, "Expected a date in YYYY-MM-DD format");
export const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected time as HH:mm");

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const serviceListQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(50).optional(),
  maxPrice: z.coerce.number().int().min(0).max(1_000_000).optional(), // whole currency units
  maxDuration: z.coerce.number().int().min(5).max(480).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export const availabilityQuerySchema = z.object({
  serviceId: idSchema,
  date: dateKeySchema,
});

export const createBookingSchema = z.object({
  slotId: idSchema,
  notes: z.string().trim().max(500).optional(),
});

export const bookingListQuerySchema = paginationSchema.extend({
  view: z.enum(["upcoming", "past", "cancelled", "all"]).default("upcoming"),
  q: z.string().trim().max(100).optional(),
});

export const adminBookingListQuerySchema = paginationSchema.extend({
  status: z.enum(["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED"]).optional(),
  serviceId: idSchema.optional(),
  q: z.string().trim().max(100).optional(),
  from: dateKeySchema.optional(),
  to: dateKeySchema.optional(),
});

const serviceFields = {
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().min(10).max(2000),
  category: z.string().trim().min(2).max(50),
  durationMinutes: z.coerce.number().int().min(5).max(480),
  priceCents: z.coerce.number().int().min(0).max(100_000_000),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .default("GBP"),
  isActive: z.boolean().default(true),
};

export const createServiceSchema = z.object(serviceFields);
export const updateServiceSchema = z
  .object({
    name: serviceFields.name,
    description: serviceFields.description,
    category: serviceFields.category,
    durationMinutes: serviceFields.durationMinutes,
    priceCents: serviceFields.priceCents,
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
    isActive: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Provide at least one field to update");

export const availabilityRuleSchema = z
  .object({
    serviceId: idSchema,
    weekday: z.coerce.number().int().min(0).max(6),
    openTime: timeSchema,
    closeTime: timeSchema,
    slotIntervalMinutes: z.coerce.number().int().min(5).max(480),
    effectiveFrom: dateKeySchema.optional(),
    effectiveTo: dateKeySchema.optional(),
  })
  .refine((r) => r.openTime < r.closeTime, { message: "Opening time must be before closing time", path: ["closeTime"] })
  .refine((r) => !r.effectiveFrom || !r.effectiveTo || r.effectiveFrom <= r.effectiveTo, {
    message: "Effective end must be on or after the start",
    path: ["effectiveTo"],
  });

export const generateSlotsSchema = z
  .object({
    serviceId: idSchema,
    from: dateKeySchema,
    to: dateKeySchema,
  })
  .refine((v) => v.from <= v.to, { message: "'from' must be on or before 'to'", path: ["to"] });

export const updateSlotSchema = z.object({ status: z.enum(["AVAILABLE", "BLOCKED"]) });

export const adminBookingActionSchema = z.object({ action: z.enum(["cancel", "complete"]) });

export const knowledgeTextSchema = z.object({
  title: z.string().trim().min(3).max(120),
  category: z.enum(["policy", "faq", "services", "hours", "general"]),
  content: z.string().trim().min(20, "Document is too short").max(200_000),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and dashes")
    .max(80)
    .optional(),
});

export const chatRequestSchema = z.object({
  message: z.string().trim().min(1, "Type a question").max(1000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(12)
    .default([]),
});
