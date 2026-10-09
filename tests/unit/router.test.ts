import { describe, expect, it } from "vitest";
import { classifyIntent, matchService, parseBudget, parseDate, parseReference, parseTime } from "@/server/assistant/router";

const TZ = "Europe/London";
const TODAY = "2026-10-09"; // a Friday

const services = [
  { id: "s1", name: "Deep Tissue Massage", slug: "deep-tissue-massage", category: "Wellness" },
  { id: "s2", name: "Guided Meditation", slug: "guided-meditation", category: "Wellness" },
  { id: "s3", name: "Physio Check-in", slug: "physio-check-in", category: "Health" },
  { id: "s4", name: "Career Coaching", slug: "career-coaching", category: "Coaching" },
];

describe("classifyIntent", () => {
  it.each([
    ["What is your cancellation policy?", "policy_question"],
    ["Can I cancel for free the day before?", "policy_question"],
    ["How far in advance can I book?", "policy_question"],
    ["Please cancel my booking SLT-ABC234", "cancel"],
    ["cancel my massage appointment", "cancel"],
    ["Any massage slots tomorrow afternoon?", "availability"],
    ["When is the next available physio?", "availability"],
    ["Book me a meditation on Monday at 10am", "book"],
    ["I'd like to book career coaching", "book"],
    ["Show my upcoming bookings", "my_bookings"],
    ["Recommend something for stress under £60", "service_search"],
    ["hello", "greeting"],
  ])("%s → %s", (message, intent) => {
    expect(classifyIntent(message)).toBe(intent);
  });
});

describe("matchService", () => {
  it("matches names, partial names and synonyms", () => {
    expect(matchService("deep tissue massage please", services)?.id).toBe("s1");
    expect(matchService("any massage?", services)?.id).toBe("s1");
    expect(matchService("I need physiotherapy for my knee", services)?.id).toBe("s3");
    expect(matchService("help me with mindfulness", services)?.id).toBe("s2");
    expect(matchService("interview practice", services)?.id).toBe("s4");
    expect(matchService("what are your opening hours", services)).toBeUndefined();
  });
});

describe("parseDate (business time zone)", () => {
  it("resolves relative days", () => {
    expect(parseDate("today", TODAY, TZ)).toMatchObject({ dateFrom: "2026-10-09", specificDay: true });
    expect(parseDate("tomorrow morning", TODAY, TZ)).toMatchObject({ dateFrom: "2026-10-10" });
    expect(parseDate("the day after tomorrow", TODAY, TZ)).toMatchObject({ dateFrom: "2026-10-11" });
  });
  it("resolves weekday names to the next occurrence", () => {
    expect(parseDate("on monday", TODAY, TZ)).toMatchObject({ dateFrom: "2026-10-12" });
    expect(parseDate("next friday", TODAY, TZ)).toMatchObject({ dateFrom: "2026-10-16" });
    expect(parseDate("this friday", TODAY, TZ)).toMatchObject({ dateFrom: "2026-10-09" });
  });
  it("resolves explicit dates, rolling into next year when needed", () => {
    expect(parseDate("on 14 Oct", TODAY, TZ)).toMatchObject({ dateFrom: "2026-10-14" });
    expect(parseDate("October 20th", TODAY, TZ)).toMatchObject({ dateFrom: "2026-10-20" });
    expect(parseDate("on 3 jan", TODAY, TZ)).toMatchObject({ dateFrom: "2027-01-03" });
    expect(parseDate("2026-11-02", TODAY, TZ)).toMatchObject({ dateFrom: "2026-11-02" });
  });
  it("resolves ranges", () => {
    expect(parseDate("next week", TODAY, TZ)).toEqual({ dateFrom: "2026-10-12", dateTo: "2026-10-18" });
    expect(parseDate("this weekend", TODAY, TZ)).toEqual({ dateFrom: "2026-10-10", dateTo: "2026-10-11" });
  });
  it("returns nothing when no date is mentioned", () => {
    expect(parseDate("what is your policy", TODAY, TZ)).toEqual({});
  });
});

describe("parseTime", () => {
  it("parses parts of day and explicit times", () => {
    expect(parseTime("tomorrow afternoon")).toEqual({ timeFromMinutes: 720, timeToMinutes: 1020 });
    expect(parseTime("after 3pm")).toEqual({ timeFromMinutes: 900 });
    expect(parseTime("before 11am")).toEqual({ timeToMinutes: 660 });
    expect(parseTime("at 10am")).toMatchObject({ exactMinutes: 600 });
    expect(parseTime("at 14:30")).toMatchObject({ exactMinutes: 870 });
  });
});

describe("parseBudget / parseReference", () => {
  it("extracts price and duration limits", () => {
    expect(parseBudget("something under £60")).toEqual({ maxPrice: 60 });
    expect(parseBudget("less than 45 minutes")).toEqual({ maxDuration: 45 });
  });
  it("extracts booking references", () => {
    expect(parseReference("cancel slt-abc234 please")).toBe("SLT-ABC234");
    expect(parseReference("no reference here")).toBeUndefined();
  });
});
