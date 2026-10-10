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
    ["Recommend something for stress under ₹1,000", "service_search"],
    ["Recommend something for stress under £60", "service_search"],
    ["hello", "greeting"],
    // Regressions from real usage
    ["who are you ?", "greeting"],
    ["What can you help me with?", "greeting"],
    ["cancel the physio Check-in", "cancel"],
    ["please cancel my massage", "cancel"],
    ["Can you cancel my booking on Monday?", "cancel"],
    ["Can I cancel my booking for free?", "policy_question"],
    ["What happens if I cancel late?", "policy_question"],
    ["are there any my bookings ?", "my_bookings"],
    ["Do I have any appointments?", "my_bookings"],
    ["What are the current available services ?", "service_search"],
    ["Which services do you have?", "service_search"],
    ["What do you offer?", "service_search"],
    ["Which times are available for massage sessions tomorrow?", "availability"],
    ["Is there availability for physio on Friday?", "availability"],
    ["Can I reschedule my appointment?", "policy_question"],
    ["What are your opening hours on Saturday?", "policy_question"],
    ["Meditation openings next week", "availability"],
    ["Book a massage on Monday morning", "book"],
    ["Cancel my physio check-in", "cancel"],
    ["Recommend something for back pain", "service_search"],
    ["Which services are under ₹1,500?", "service_search"],
    ["Can I have my session by video call?", "policy_question"],
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
    // Rupees: symbol, "Rs", "INR", "rupees" and Indian digit grouping
    expect(parseBudget("something under ₹1,000")).toEqual({ maxPrice: 1000 });
    expect(parseBudget("below rs. 900")).toEqual({ maxPrice: 900 });
    expect(parseBudget("less than 2000 rupees")).toEqual({ maxPrice: 2000 });
    expect(parseBudget("up to inr 1,50,000")).toEqual({ maxPrice: 150000 });
    expect(parseBudget("budget of ₹2500 and less than 45 minutes")).toEqual({ maxPrice: 2500, maxDuration: 45 });
    expect(parseBudget("less than 45 minutes")).toEqual({ maxDuration: 45 });
  });
  it("extracts booking references", () => {
    expect(parseReference("cancel slt-abc234 please")).toBe("SLT-ABC234");
    expect(parseReference("no reference here")).toBeUndefined();
  });
});
