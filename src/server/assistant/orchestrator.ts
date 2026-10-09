import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Actor } from "../authz";
import { prisma } from "../db";
import { getConfig } from "@/lib/config";
import { addDaysToKey, formatInZone, isDateKey, todayKey as getTodayKey } from "@/lib/time";
import { formatDuration, formatPrice } from "@/lib/money";
import type { AssistantReply } from "@/lib/assistant-types";
import { getLlm, parseJsonObject } from "../rag/llm";
import { INTENT_SYSTEM_PROMPT } from "../rag/prompts";
import { INTENTS, classifyIntent, matchService, parseRequest, type ParsedRequest, type ServiceRef } from "./router";
import * as tools from "./tools";

type History = { role: "user" | "assistant"; content: string }[];

const DEFAULT_SUGGESTIONS = [
  "What is your cancellation policy?",
  "Any massage slots tomorrow afternoon?",
  "Recommend something for stress under £60",
  "Show my upcoming bookings",
];

/**
 * Entry point for the assistant. Routes the message to an intent, runs the
 * matching read-only tools and returns structured results for the UI.
 */
export async function handleChat(actor: Actor | null, message: string, history: History, now = new Date()): Promise<AssistantReply> {
  const { BUSINESS_TIMEZONE: tz } = getConfig();
  const today = getTodayKey(tz, now);
  const services = await tools.listServiceRefs();
  const llm = getLlm();

  let request = parseRequest(message, { services, todayKey: today, tz });
  let routedBy = "rules";
  if (llm) {
    const fromLlm = await llmParse(message, history, services, today).catch(() => null);
    if (fromLlm) {
      request = mergeParsed(request, fromLlm);
      routedBy = "llm";
    }
  }
  request = applyConversationContext(request, message, history, services);

  const reply = await dispatch(actor, request, message, history, services, today, tz);

  void logTurn(actor, reply, routedBy).catch(() => undefined);
  return reply;
}

async function dispatch(
  actor: Actor | null,
  req: ParsedRequest,
  message: string,
  history: History,
  services: ServiceRef[],
  today: string,
  tz: string,
): Promise<AssistantReply & { telemetry?: unknown }> {
  const base: ReplyBase = { id: randomUUID(), intent: req.intent, sources: [], timeZone: tz };
  const serviceName = (id?: string) => services.find((s) => s.id === id)?.name;

  switch (req.intent) {
    case "greeting":
      return {
        ...base,
        mode: "tool",
        text: "Hi! I can answer questions about Slotly's services and policies, find live open times, and help you book or cancel. What would you like to do?",
        suggestions: DEFAULT_SUGGESTIONS,
      };

    case "service_search": {
      const query = req.maxPrice || req.maxDuration ? stripBudget(message) : message;
      const res = await tools.search_services({ query, maxPrice: req.maxPrice, maxDuration: req.maxDuration });
      const criteria = [
        req.maxPrice !== undefined ? `under ${formatPrice(req.maxPrice * 100, "GBP")}` : null,
        req.maxDuration !== undefined ? `up to ${formatDuration(req.maxDuration)}` : null,
      ].filter(Boolean);
      if (res.services.length === 0) {
        return {
          ...base,
          mode: "tool",
          text: `I couldn't find an active service ${criteria.join(" and ") || "matching that"}. Here's everything we currently offer instead.`,
          services: (await tools.search_services({})).services,
        };
      }
      const lead =
        res.matchedBy === "semantic"
          ? `Based on our service descriptions, these look like the best fit${criteria.length ? ` (${criteria.join(", ")})` : ""}:`
          : criteria.length
            ? `These services are ${criteria.join(" and ")}:`
            : "Here are the services we currently offer:";
      return {
        ...base,
        mode: "tool",
        text: `${lead} Prices and durations below come straight from our booking system.`,
        services: res.services,
        suggestions: res.services.slice(0, 2).map((s) => `Next available ${s.name}`),
      };
    }

    case "availability":
    case "book": {
      if (!req.serviceId && !req.specificDay) {
        return {
          ...base,
          mode: "clarify",
          text: "Which service would you like to see times for? You can also tell me a day, like “tomorrow afternoon”.",
          suggestions: services.slice(0, 6).map((s) => `${req.intent === "book" ? "Book" : "Availability for"} ${s.name}`),
        };
      }
      const fromKey = req.dateFrom && req.dateFrom >= today ? req.dateFrom : today;
      const toKey = req.dateTo && req.dateTo >= fromKey ? req.dateTo : req.specificDay ? fromKey : addDaysToKey(fromKey, 6, tz);
      const slots = await tools.get_available_slots({
        serviceId: req.serviceId,
        fromKey,
        toKey,
        timeFromMinutes: req.timeFromMinutes,
        timeToMinutes: req.exactMinutes !== undefined ? undefined : req.timeToMinutes,
        limit: 12,
      });
      const what = serviceName(req.serviceId) ?? "any service";
      const when =
        fromKey === toKey ? formatInZone(`${fromKey}T12:00:00Z`, "EEEE d MMMM", "UTC") : `${formatInZone(`${fromKey}T12:00:00Z`, "EEE d MMM", "UTC")} – ${formatInZone(`${toKey}T12:00:00Z`, "EEE d MMM", "UTC")}`;

      if (slots.length === 0) {
        return {
          ...base,
          mode: "tool",
          text: `There are no open times for ${what} on ${when}${req.timeFromMinutes !== undefined ? " in that time window" : ""}. Try another day or a different time of day.`,
          suggestions: req.serviceId ? [`Next available ${serviceName(req.serviceId)}`] : DEFAULT_SUGGESTIONS.slice(1, 3),
        };
      }

      // An exact time on a specific day → propose that single slot for confirmation.
      if (req.intent === "book" && req.exactMinutes !== undefined && req.specificDay) {
        const exact = slots.find((s) => minutesOf(s.startAt, tz) === req.exactMinutes);
        if (exact && (await tools.check_slot({ slotId: exact.id }))) {
          return {
            ...base,
            mode: "tool",
            text: `${exact.service.name} on ${formatInZone(exact.startAt, "EEEE d MMMM 'at' HH:mm", tz)} is open (${formatDuration(exact.service.durationMinutes)}, ${formatPrice(exact.service.priceCents, exact.service.currency)}). ${actor ? "Please review and confirm below — nothing is booked until you confirm." : "Choose a demo account to confirm this booking."}`,
            proposal: exact,
            requiresSignIn: !actor,
          };
        }
      }

      const intro =
        req.intent === "book"
          ? `Here are the open times for ${what} on ${when}. Choose one to review and confirm${actor ? "" : " (you'll need to choose a demo account first)"}.`
          : `Here are the open times for ${what} on ${when}, checked live just now.`;
      const exactMissed =
        req.intent === "book" && req.exactMinutes !== undefined ? "That exact time isn't available, but these are. " : "";
      return { ...base, mode: "tool", text: exactMissed + intro, slots, requiresSignIn: req.intent === "book" && !actor };
    }

    case "my_bookings": {
      if (!actor) return { ...base, mode: "clarify", text: "Choose a demo account first so I can show its bookings.", requiresSignIn: true };
      const bookings = await tools.get_my_bookings(actor);
      return {
        ...base,
        mode: "tool",
        text: bookings.length
          ? `You have ${bookings.length} upcoming booking${bookings.length === 1 ? "" : "s"}.`
          : "You don't have any upcoming bookings. Would you like to find a time?",
        bookings,
        suggestions: bookings.length ? [] : DEFAULT_SUGGESTIONS.slice(1, 3),
      };
    }

    case "cancel": {
      if (!actor) return { ...base, mode: "clarify", text: "Choose a demo account first so I can find its bookings.", requiresSignIn: true };
      if (req.bookingReference) {
        const booking = await tools.get_booking_details(actor, req.bookingReference);
        if (!booking) {
          return { ...base, mode: "tool", text: `I couldn't find a booking with reference ${req.bookingReference} on your account.` };
        }
        return cancellationReply(base, booking);
      }
      const upcoming = await tools.get_my_bookings(actor);
      if (upcoming.length === 0) return { ...base, mode: "tool", text: "You don't have any upcoming bookings to cancel." };
      if (upcoming.length === 1) return cancellationReply(base, upcoming[0]);
      return {
        ...base,
        mode: "clarify",
        text: "Which booking would you like to cancel? Choose one below, or tell me its reference (e.g. SLT-ABC234).",
        bookings: upcoming,
      };
    }

    case "policy_question":
    default: {
      const answer = await tools.search_booking_policies(message, history);
      return {
        ...base,
        intent: "policy_question",
        mode: answer.mode,
        confidence: answer.confidence,
        text: answer.text,
        sources: answer.sources,
        notice: answer.notice,
        telemetry: answer.telemetry,
      };
    }
  }
}

type ReplyBase = Pick<AssistantReply, "id" | "intent" | "sources" | "timeZone">;

function cancellationReply(base: ReplyBase, booking: NonNullable<AssistantReply["cancellationTarget"]>): AssistantReply {
  const when = formatInZone(booking.slot.startAt, "EEEE d MMMM 'at' HH:mm", base.timeZone);
  if (booking.status === "CANCELLED") {
    return { ...base, mode: "tool", text: `Booking ${booking.publicReference} (${booking.service.name}, ${when}) is already cancelled.` };
  }
  if (!booking.cancellation.allowed) {
    return {
      ...base,
      mode: "tool",
      text: `Booking ${booking.publicReference} (${booking.service.name}, ${when}) can't be cancelled online: ${booking.cancellation.reason}`,
      bookings: [booking],
    };
  }
  return {
    ...base,
    mode: "tool",
    text: `Found ${booking.publicReference}: ${booking.service.name} on ${when}. Confirm below to cancel it — nothing changes until you confirm.`,
    cancellationTarget: booking,
  };
}

function minutesOf(iso: string, tz: string) {
  const [h, m] = formatInZone(iso, "HH:mm", tz).split(":").map(Number);
  return h * 60 + m;
}

function stripBudget(message: string) {
  return message.replace(/(under|below|less than|max(imum)?|up to|within|cheaper than)\s*[£$€]?\s*\d+\s*(min(ute)?s?|hours?)?/gi, "").trim();
}

/** Follow-ups such as "what about Friday?" inherit the service and intent of the previous turn. */
function applyConversationContext(req: ParsedRequest, message: string, history: History, services: ServiceRef[]): ParsedRequest {
  const previousUser = history.filter((h) => h.role === "user").slice(-3).reverse();
  let next = req;
  const looksLikeFollowUp = /^(and |what about|how about|ok(ay)?|then|also)\b/i.test(message.trim()) || message.trim().split(/\s+/).length <= 4;

  if (!next.serviceId && ["availability", "book"].includes(next.intent)) {
    for (const h of previousUser) {
      const s = matchService(h.content, services);
      if (s) {
        next = { ...next, serviceId: s.id };
        break;
      }
    }
  }
  if (next.intent === "policy_question" && looksLikeFollowUp && (next.specificDay || next.timeFromMinutes !== undefined)) {
    const prevIntent = previousUser[0] ? classifyIntent(previousUser[0].content) : null;
    if (prevIntent === "availability" || prevIntent === "book") {
      const s = next.serviceId ? undefined : previousUser.map((h) => matchService(h.content, services)).find(Boolean);
      next = { ...next, intent: prevIntent, ...(s ? { serviceId: s.id } : {}) };
    }
  }
  return next;
}

// ── Optional LLM-based structured parsing (validated, falls back to rules) ───

const LlmIntentSchema = z.object({
  intent: z.enum(INTENTS),
  service: z.string().nullish(),
  date: z.string().nullish(),
  dateFrom: z.string().nullish(),
  dateTo: z.string().nullish(),
  timeFrom: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  timeTo: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  maxPrice: z.number().nullish(),
  maxDuration: z.number().nullish(),
  bookingReference: z.string().nullish(),
});

async function llmParse(message: string, history: History, services: ServiceRef[], today: string): Promise<ParsedRequest | null> {
  const llm = getLlm();
  if (!llm) return null;
  const context = `today: ${today}\nservices: ${services.map((s) => s.name).join("; ")}\nrecent conversation:\n${history
    .slice(-4)
    .map((h) => `${h.role}: ${h.content.slice(0, 300)}`)
    .join("\n")}`;
  const result = await llm.complete(
    [
      { role: "system", content: INTENT_SYSTEM_PROMPT },
      { role: "user", content: `${context}\n\nmessage: ${message}` },
    ],
    { json: true, maxTokens: 250, temperature: 0 },
  );
  const parsed = LlmIntentSchema.safeParse(parseJsonObject(result.text));
  if (!parsed.success) return null;
  const p = parsed.data;
  // The model may only *refer* to services by name; ids are resolved here, never trusted from the model.
  const service = p.service ? services.find((s) => s.name.toLowerCase() === p.service!.toLowerCase()) ?? matchService(p.service, services) : undefined;
  const validDate = (d?: string | null) => (d && isDateKey(d) && d >= today ? d : undefined);
  const toMin = (t?: string | null) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : undefined);
  const date = validDate(p.date);
  return {
    intent: p.intent,
    serviceId: service?.id,
    dateFrom: date ?? validDate(p.dateFrom),
    dateTo: date ?? validDate(p.dateTo),
    specificDay: Boolean(date),
    timeFromMinutes: toMin(p.timeFrom),
    timeToMinutes: toMin(p.timeTo),
    maxPrice: p.maxPrice ?? undefined,
    maxDuration: p.maxDuration ?? undefined,
    bookingReference: p.bookingReference?.toUpperCase().match(/^SLT-[A-Z0-9]{6}$/)?.[0],
  };
}

function mergeParsed(rules: ParsedRequest, llm: ParsedRequest): ParsedRequest {
  const pick = <K extends keyof ParsedRequest>(k: K) => (llm[k] !== undefined ? llm[k] : rules[k]);
  return {
    intent: llm.intent,
    serviceId: pick("serviceId"),
    dateFrom: pick("dateFrom"),
    dateTo: pick("dateTo"),
    specificDay: llm.specificDay || rules.specificDay,
    timeFromMinutes: pick("timeFromMinutes"),
    timeToMinutes: pick("timeToMinutes"),
    exactMinutes: rules.exactMinutes,
    maxPrice: pick("maxPrice"),
    maxDuration: pick("maxDuration"),
    // References are only trusted when literally present in the user's message.
    bookingReference: rules.bookingReference,
  };
}

// ── Observability (no message text, no personal data) ────────────────────────

async function logTurn(actor: Actor | null, reply: AssistantReply & { telemetry?: unknown }, routedBy: string) {
  const t = (reply.telemetry ?? {}) as {
    retrievalMs?: number;
    generationMs?: number;
    sourceChunkIds?: string[];
    promptTokens?: number;
    completionTokens?: number;
    provider?: string;
    error?: string;
  };
  await prisma.assistantLog.create({
    data: {
      userId: actor?.id ?? null,
      intent: reply.intent,
      mode: `${reply.mode}/${routedBy}`,
      provider: t.provider ?? "none",
      retrievalMs: t.retrievalMs ?? null,
      generationMs: t.generationMs ?? null,
      sourceChunkIds: t.sourceChunkIds ?? [],
      promptTokens: t.promptTokens ?? null,
      completionTokens: t.completionTokens ?? null,
      error: t.error?.slice(0, 300) ?? null,
    },
  });
}

/** Strips internal telemetry before the reply is sent to the browser. */
export function toPublicReply(reply: AssistantReply & { telemetry?: unknown }): AssistantReply {
  const { telemetry, ...rest } = reply;
  void telemetry;
  return rest;
}
