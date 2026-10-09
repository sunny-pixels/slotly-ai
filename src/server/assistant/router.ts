import { addDaysToKey, isDateKey, weekdayOf } from "@/lib/time";

/**
 * Deterministic intent router + slot-filling parser. It is used on its own when
 * no LLM is configured and as the validated fallback when the LLM's structured
 * output is missing or invalid. Pure — no I/O — so it is fully unit-tested.
 */

export const INTENTS = ["policy_question", "service_search", "availability", "book", "cancel", "my_bookings", "greeting"] as const;
export type Intent = (typeof INTENTS)[number];

export type ServiceRef = { id: string; name: string; slug: string; category: string };

export type ParsedRequest = {
  intent: Intent;
  serviceId?: string;
  dateFrom?: string; // business-local YYYY-MM-DD
  dateTo?: string;
  /** True when the user named a specific day ("tomorrow", "Friday", "12 Oct"). */
  specificDay?: boolean;
  timeFromMinutes?: number;
  timeToMinutes?: number;
  /** Exact clock time requested ("at 10am") — used to propose a single slot. */
  exactMinutes?: number;
  maxPrice?: number;
  maxDuration?: number;
  bookingReference?: string;
};

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const SERVICE_SYNONYMS: Record<string, string[]> = {
  massage: ["massage", "deep tissue", "sore muscles", "muscle tension", "knots"],
  meditation: ["meditation", "meditate", "mindfulness", "breathing", "calm"],
  nutrition: ["nutrition", "diet", "nutritionist", "meal plan", "eating"],
  physio: ["physio", "physiotherapy", "injury", "rehab", "back pain", "knee"],
  career: ["career", "job", "interview", "cv", "resume", "promotion"],
  strategy: ["strategy", "business", "startup", "consultation", "consulting"],
};

function norm(text: string) {
  return text.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
}

export function matchService(message: string, services: ServiceRef[]): ServiceRef | undefined {
  const text = norm(message);
  // 1. Full name or slug mention.
  const direct = services.find((s) => text.includes(s.name.toLowerCase()) || text.includes(s.slug.replace(/-/g, " ")));
  if (direct) return direct;
  // 2. Distinctive name tokens ("massage", "physio", "meditation").
  const stop = new Set(["session", "check", "consultation", "with", "the", "and", "in"]);
  let best: { s: ServiceRef; score: number } | undefined;
  for (const s of services) {
    const tokens = s.name.toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 3 && !stop.has(t));
    let score = tokens.filter((t) => new RegExp(`\\b${t.slice(0, Math.max(5, t.length - 2))}`).test(text)).length;
    for (const [key, words] of Object.entries(SERVICE_SYNONYMS)) {
      if (s.slug.includes(key) && words.some((w) => text.includes(w))) score += 1;
    }
    if (score > 0 && (!best || score > best.score)) best = { s, score };
  }
  return best?.s;
}

export function parseDate(message: string, todayKey: string, tz: string): Pick<ParsedRequest, "dateFrom" | "dateTo" | "specificDay"> {
  const text = norm(message);

  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso && isDateKey(iso[1])) return { dateFrom: iso[1], dateTo: iso[1], specificDay: true };

  if (/\b(today|tonight|this (morning|afternoon|evening))\b/.test(text)) return { dateFrom: todayKey, dateTo: todayKey, specificDay: true };
  if (/\bday after tomorrow\b/.test(text)) {
    const d = addDaysToKey(todayKey, 2, tz);
    return { dateFrom: d, dateTo: d, specificDay: true };
  }
  if (/\b(tomorrow|tmrw|tmr)\b/.test(text)) {
    const d = addDaysToKey(todayKey, 1, tz);
    return { dateFrom: d, dateTo: d, specificDay: true };
  }

  // "12 oct", "12th october", "october 12"
  const dm = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/);
  const md = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  const dayMonth = dm ? { day: Number(dm[1]), month: MONTHS.indexOf(dm[2]) } : md ? { day: Number(md[2]), month: MONTHS.indexOf(md[1]) } : null;
  // UK numeric "12/10"
  const slash = !dayMonth ? text.match(/\b(\d{1,2})\/(\d{1,2})\b/) : null;
  const dmResolved = dayMonth ?? (slash ? { day: Number(slash[1]), month: Number(slash[2]) - 1 } : null);
  if (dmResolved && dmResolved.month >= 0 && dmResolved.month < 12) {
    const year = Number(todayKey.slice(0, 4));
    for (const y of [year, year + 1]) {
      const key = `${y}-${String(dmResolved.month + 1).padStart(2, "0")}-${String(dmResolved.day).padStart(2, "0")}`;
      if (isDateKey(key) && key >= todayKey) return { dateFrom: key, dateTo: key, specificDay: true };
    }
  }

  if (/\bnext week\b/.test(text)) {
    const wd = weekdayOf(todayKey, tz);
    const nextMonday = addDaysToKey(todayKey, ((8 - wd) % 7) || 7, tz);
    return { dateFrom: nextMonday, dateTo: addDaysToKey(nextMonday, 6, tz) };
  }
  if (/\b(this )?weekend\b/.test(text)) {
    const wd = weekdayOf(todayKey, tz);
    const sat = addDaysToKey(todayKey, (6 - wd + 7) % 7, tz);
    return { dateFrom: wd === 0 ? todayKey : sat, dateTo: wd === 0 ? todayKey : addDaysToKey(sat, 1, tz) };
  }
  if (/\bthis week\b/.test(text)) {
    const wd = weekdayOf(todayKey, tz);
    return { dateFrom: todayKey, dateTo: addDaysToKey(todayKey, wd === 0 ? 0 : 7 - wd, tz) };
  }

  const wdMatch = text.match(/\b(next |this |on )?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(day|sday|nesday|rsday|urday)?\b/);
  if (wdMatch) {
    const target = WEEKDAYS.findIndex((w) => w.startsWith(wdMatch[2].slice(0, 3)));
    const wd = weekdayOf(todayKey, tz);
    let delta = (target - wd + 7) % 7;
    if (wdMatch[1]?.trim() === "next" && delta === 0) delta = 7;
    const d = addDaysToKey(todayKey, delta, tz);
    return { dateFrom: d, dateTo: d, specificDay: true };
  }
  return {};
}

export function parseTime(message: string): Pick<ParsedRequest, "timeFromMinutes" | "timeToMinutes" | "exactMinutes"> {
  const text = norm(message);
  const clock = (h: string, m: string | undefined, ap: string | undefined) => {
    let hour = Number(h);
    if (ap === "pm" && hour < 12) hour += 12;
    if (ap === "am" && hour === 12) hour = 0;
    if (!ap && hour >= 1 && hour <= 7) hour += 12; // "at 3" in a booking context means 15:00
    return hour * 60 + Number(m ?? 0);
  };
  const after = text.match(/\b(?:after|from|later than)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  const before = text.match(/\b(?:before|by|earlier than|until)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);
  if (after || before) {
    return {
      ...(after ? { timeFromMinutes: clock(after[1], after[2], after[3]) } : {}),
      ...(before ? { timeToMinutes: clock(before[1], before[2], before[3]) } : {}),
    };
  }
  const at = text.match(/\b(?:at|for|around)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/) ?? text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/) ?? text.match(/\b(\d{1,2}):(\d{2})\b()/);
  if (at) {
    const minutes = clock(at[1], at[2], at[3] || undefined);
    if (minutes >= 0 && minutes < 24 * 60) return { exactMinutes: minutes, timeFromMinutes: minutes, timeToMinutes: minutes + 1 };
  }
  if (/\bmorning\b/.test(text)) return { timeFromMinutes: 0, timeToMinutes: 12 * 60 };
  if (/\b(afternoon|lunch ?time)\b/.test(text)) return { timeFromMinutes: 12 * 60, timeToMinutes: 17 * 60 };
  if (/\b(evening|after work|tonight)\b/.test(text)) return { timeFromMinutes: 17 * 60, timeToMinutes: 24 * 60 };
  return {};
}

export function parseBudget(message: string): Pick<ParsedRequest, "maxPrice" | "maxDuration"> {
  const text = norm(message);
  const price = text.match(/(?:under|below|less than|max(?:imum)?|up to|cheaper than|within)\s*[£$€]?\s*(\d{1,5})(?!\d)(?!\s*(?:min|minute|hour|h\b))/);
  const duration = text.match(/(?:under|below|less than|max(?:imum)?|up to|within|no more than)\s*(\d{1,3})\s*(?:min|minutes|mins)\b/);
  const hours = text.match(/(?:under|below|less than|up to|within)\s*(\d)\s*(?:hour|hours|h)\b/);
  return {
    ...(price ? { maxPrice: Number(price[1]) } : {}),
    ...(duration ? { maxDuration: Number(duration[1]) } : hours ? { maxDuration: Number(hours[1]) * 60 } : {}),
  };
}

export function parseReference(message: string): string | undefined {
  return message.toUpperCase().match(/\bSLT-[A-Z0-9]{6}\b/)?.[0];
}

export function classifyIntent(message: string): Intent {
  const text = norm(message);
  const isQuestionAboutRules =
    /\b(policy|policies|fee|fees|charge|charged|refund|deposit|rule|rules|allowed|penalt|how (far|long|much|many|do|does|can)|what happens|is there|do you|can i|am i)\b/.test(text);

  // Small talk and questions about the assistant itself — never sent to document search.
  if (
    /^(hi|hiya|hello|hey|good (morning|afternoon|evening)|help|thanks?( you)?|thank you|ok(ay)?)\b[!.?\s]*$/.test(text) ||
    /\b(who are you|what are you|who am i (talking|speaking) to|what can you (do|help( me)? with)|how (can|do) you help|are you (a bot|an ai|ai|human|a human|real))\b/.test(text)
  ) {
    return "greeting";
  }

  // Cancellation *actions* ("cancel the physio check-in"), as opposed to questions about the
  // cancellation *policy* ("can I cancel for free?", "what happens if I cancel late?").
  const asksAboutCancelRules = /\b(policy|policies|fee|fees|refund|charge|charged|free|late|how|what happens|rules?|can i|am i|allowed)\b/.test(text);
  if (parseReference(text) && /\bcancel/.test(text)) return "cancel";
  if (!asksAboutCancelRules) {
    if (/^(please |pls |kindly |just )?(cancel|call off)\b/.test(text)) return "cancel";
    if (/\b(can you|could you|please|i (want|need|would like|'d like) to|go ahead and|help me) (cancel|call off)\b/.test(text)) return "cancel";
    if (/\bcancel (my|the|this|that|our)\b.*\b(booking|appointment|reservation|session)\b/.test(text)) return "cancel";
  }

  if (
    !/\bcancel/.test(text) &&
    // "Can I reschedule my appointment?" is a policy question, not a request to list bookings.
    !/\b(can i|how do i|how can i|am i|is it|policy|reschedul|move|change)\b/.test(text) &&
    /\b(my|upcoming|existing) (bookings?|appointments?|reservations?)\b|\bwhat (have i|did i) book|\bshow (me )?my\b|\bdo i have any\b/.test(text)
  ) {
    return "my_bookings";
  }

  // "What services do you have?", "list the available services", "what do you offer?"
  if (
    (/\b(services|treatments|sessions|options)\b/.test(text) && /\b(what|which|list|show|available|current|all|offer|have|provide)\b/.test(text)) ||
    /\bwhat (else )?do you (offer|do|provide)\b/.test(text)
  ) {
    const aboutTimes = /\b(slots?|times?|when|today|tomorrow|tonight|morning|afternoon|evening|week|weekend|mon|tue|wed|thu|fri|sat|sun)\w*\b/.test(text);
    if (!aboutTimes && !/\b(policy|cancel|refund|fee|hours|open|opening)\b/.test(text)) return "service_search";
  }

  if (
    /^(please )?(book|reserve)\b|\b(i('d| would) like to|i want to|i need to|can you|could you|please|let's|help me) (book|reserve|schedule)\b|\bbook (me|it|that|this|a|an|the)\b/.test(text) &&
    !/\bhow (far|long|do|does)\b|\bin advance\b/.test(text)
  ) {
    return "book";
  }

  if (
    !/\bopening (hours|times)\b|\bwhen (are|is) (you|the studio) open\b/.test(text) &&
    /\b(availab\w*|free slots?|free time|openings?|open slots?|any (slots|times|space|spaces|appointments)|when can i|next (available|free|open)|what times|which times|slots? (on|for|tomorrow|today|this|next))\b/.test(text)) {
    return "availability";
  }

  if (
    !isQuestionAboutRules &&
    /\b(recommend|suggest|which service|what services|services do you|do you offer|options|looking for|something (for|to)|help (with|me with)|under [£$€]?\d|less than \d+ ?min|cheapest|shortest)\b/.test(text)
  ) {
    return "service_search";
  }
  return "policy_question";
}

export function parseRequest(message: string, ctx: { services: ServiceRef[]; todayKey: string; tz: string }): ParsedRequest {
  const intent = classifyIntent(message);
  const service = matchService(message, ctx.services);
  return {
    intent,
    ...(service ? { serviceId: service.id } : {}),
    ...parseDate(message, ctx.todayKey, ctx.tz),
    ...parseTime(message),
    ...parseBudget(message),
    ...(parseReference(message) ? { bookingReference: parseReference(message) } : {}),
  };
}
