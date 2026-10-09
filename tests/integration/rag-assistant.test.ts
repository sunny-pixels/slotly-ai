import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { ingestKnowledgeDirectory } from "@/server/rag/knowledge-files";
import { ingestDocument } from "@/server/rag/ingest";
import { retrieve } from "@/server/rag/retrieve";
import { answerFromKnowledge } from "@/server/rag/generate";
import { setEmbeddingProviderForTests, EmbeddingError, type EmbeddingProvider } from "@/server/rag/embeddings";
import { setLlmForTests, LlmError, type LlmProvider } from "@/server/rag/llm";
import { handleChat } from "@/server/assistant/orchestrator";
import { createBooking } from "@/server/services/bookings";
import { POST as chatRoute } from "@/app/api/assistant/chat/route";
import { POST as createBookingRoute } from "@/app/api/bookings/route";
import { resetRateLimits } from "@/server/rate-limit";
import { getConfig } from "@/lib/config";
import { addDaysToKey, todayKey, zonedTime } from "@/lib/time";
import { actAs, createService, createUser, jsonRequest, resetDatabase } from "../support/fixtures";

/**
 * Uses the real local embedding model (Xenova/bge-small-en-v1.5) and the real
 * pgvector index. The first run downloads the model (~35 MB) into .cache/.
 */
describe("RAG pipeline and assistant", () => {
  beforeAll(async () => {
    await resetDatabase();
    const results = await ingestKnowledgeDirectory();
    expect(results.every((r) => r.status === "READY")).toBe(true);
  }, 300_000);

  afterEach(() => {
    setEmbeddingProviderForTests(null);
    setLlmForTests(undefined);
    actAs(null);
    resetRateLimits();
  });

  // 12. Retrieval returns relevant sources
  it("retrieves the cancellation policy for a paraphrased question, never the superseded version", async () => {
    const r = await retrieve("If something comes up the evening before, will I still have to pay?");
    expect(r.relevant.length).toBeGreaterThan(0);
    expect(r.relevant[0].documentSlug).toBe("cancellation-policy");
    expect(r.chunks.some((c) => c.documentSlug === "cancellation-policy-2024")).toBe(false);
    expect(r.chunks[0].distance).toBeGreaterThanOrEqual(0);
  });

  it("retrieves opening hours and service descriptions semantically", async () => {
    expect((await retrieve("When are you open on Saturdays?")).relevant[0]?.documentSlug).toBe("opening-hours");
    expect((await retrieve("I've been sleeping badly and feel anxious, what would help?")).relevant[0]?.documentSlug).toBe("service-catalogue");
  });

  it("does not re-embed unchanged documents, and re-versions changed ones", async () => {
    const again = await ingestKnowledgeDirectory();
    expect(again.every((r) => r.skipped)).toBe(true);

    const first = await ingestDocument({ slug: "test-doc", title: "Test doc", category: "general", content: "# Parking\nThere is no customer parking at the studio.", sourceType: "TEXT" });
    const changed = await ingestDocument({ slug: "test-doc", title: "Test doc", category: "general", content: "# Parking\nA public car park is two minutes away.", sourceType: "TEXT" });
    expect(first.version).toBe(1);
    expect(changed.version).toBe(2);
    expect(await prisma.knowledgeChunk.count({ where: { documentId: first.documentId } })).toBe(changed.chunkCount);
    await prisma.knowledgeDocument.delete({ where: { id: first.documentId } });
  });

  // 13. The assistant admits when the knowledge base cannot answer
  it("says the documentation does not cover an unrelated question, without citing anything", async () => {
    const answer = await answerFromKnowledge("How do I file my self assessment tax return?");
    expect(answer.mode).toBe("no_answer");
    expect(answer.confidence).toBe("none");
    expect(answer.sources).toHaveLength(0);
    expect(answer.text).toMatch(/couldn't find that in Slotly's documentation/i);
  });

  it("flags a loosely related passage as the closest match instead of presenting it as the answer", async () => {
    setLlmForTests(null);
    const answer = await answerFromKnowledge("What is the wifi password at the studio?");
    expect(answer.confidence).not.toBe("high");
    if (answer.mode === "extractive") expect(answer.text).toMatch(/couldn't find a direct answer/i);
    else expect(answer.mode).toBe("no_answer");
  });

  it("without an LLM, answers extractively and labels the quote with its real source", async () => {
    setLlmForTests(null);
    const answer = await answerFromKnowledge("How many hours before can I cancel for free?");
    expect(answer.mode).toBe("extractive");
    expect(answer.confidence).toBe("high");
    expect(answer.sources[0].documentSlug).toBe("cancellation-policy");
    expect(answer.text).toMatch(/^Here's what Slotly's documentation says \[S1\]/);
  });

  it("with an LLM, keeps only citations that refer to retrieved passages", async () => {
    const fake: LlmProvider = {
      name: "fake",
      model: "test",
      async complete() {
        return { text: "You can cancel free of charge up to 24 hours before [S1]. Cash is accepted [S9].", usage: { promptTokens: 10, completionTokens: 5 } };
      },
    };
    setLlmForTests(fake);
    const answer = await answerFromKnowledge("How many hours before can I cancel for free?");
    expect(answer.mode).toBe("llm");
    expect(answer.text).not.toContain("[S9]");
    expect(answer.sources.filter((s) => s.cited).map((s) => s.label)).toEqual(["S1"]);
  });

  // 14. Live availability comes from the database, not vector data
  it("answers availability questions from live slots and reflects a booking immediately", async () => {
    const tz = getConfig().BUSINESS_TIMEZONE;
    const svc = await createService({ name: "Deep Tissue Massage", slug: "deep-tissue-massage-test" });
    const day = addDaysToKey(todayKey(tz), 2, tz);
    const slot = await prisma.slot.create({
      data: { serviceId: svc.id, startAt: zonedTime(day, "10:00", tz), endAt: zonedTime(day, "11:00", tz) },
    });
    const ask = async () => handleChat(null, `Any deep tissue massage slots on ${day}?`, []);

    const before = await ask();
    expect(before.intent).toBe("availability");
    expect(before.mode).toBe("tool");
    expect(before.slots?.map((s) => s.id)).toContain(slot.id);
    expect(before.sources).toHaveLength(0); // not answered from the knowledge base

    await createBooking(await createUser(), { slotId: slot.id });
    const after = await ask();
    expect(after.slots?.map((s) => s.id) ?? []).not.toContain(slot.id);
  });

  it("never books by itself: a booking request returns a proposal and leaves the database unchanged", async () => {
    const tz = getConfig().BUSINESS_TIMEZONE;
    const user = await createUser();
    const svc = await createService({ name: "Guided Meditation", slug: "guided-meditation-test" });
    const day = addDaysToKey(todayKey(tz), 3, tz);
    const slot = await prisma.slot.create({ data: { serviceId: svc.id, startAt: zonedTime(day, "14:00", tz), endAt: zonedTime(day, "14:30", tz) } });

    const reply = await handleChat(user, `Book me a guided meditation on ${day} at 2pm`, []);
    expect(reply.intent).toBe("book");
    expect(reply.proposal?.id).toBe(slot.id);
    expect(await prisma.booking.count({ where: { slotId: slot.id } })).toBe(0);
  });

  it("only shows the signed-in customer's own bookings", async () => {
    const tz = getConfig().BUSINESS_TIMEZONE;
    const [mine, theirs] = [await createUser(), await createUser()];
    const svc = await createService({ name: "Physio Check-in", slug: "physio-test" });
    const day = addDaysToKey(todayKey(tz), 4, tz);
    const s1 = await prisma.slot.create({ data: { serviceId: svc.id, startAt: zonedTime(day, "09:00", tz), endAt: zonedTime(day, "09:30", tz) } });
    const s2 = await prisma.slot.create({ data: { serviceId: svc.id, startAt: zonedTime(day, "10:00", tz), endAt: zonedTime(day, "10:30", tz) } });
    const b1 = await createBooking(mine, { slotId: s1.id });
    const b2 = await createBooking(theirs, { slotId: s2.id });

    const reply = await handleChat(mine, "Show my upcoming bookings", []);
    expect(reply.bookings?.map((b) => b.id)).toContain(b1.id);
    expect(reply.bookings?.map((b) => b.id)).not.toContain(b2.id);

    const stolen = await handleChat(mine, `Please cancel my booking ${b2.publicReference}`, []);
    expect(stolen.cancellationTarget).toBeUndefined();
    expect(stolen.text).toMatch(/couldn't find a booking/i);
  });

  // 15. AI provider failure does not break manual booking
  it("reports a clear assistant error when embeddings and the LLM are down, while booking still works", async () => {
    const broken: EmbeddingProvider = {
      id: "broken",
      async embed() {
        throw new EmbeddingError("embedding service unavailable");
      },
    };
    const brokenLlm: LlmProvider = {
      name: "broken",
      model: "x",
      async complete() {
        throw new LlmError("LLM unavailable");
      },
    };
    setEmbeddingProviderForTests(broken);
    setLlmForTests(brokenLlm);

    const chatRes = await chatRoute(jsonRequest("/api/assistant/chat", "POST", { message: "What is your cancellation policy?" }), undefined);
    expect(chatRes.status).toBe(200);
    const { reply } = await chatRes.json();
    expect(reply.mode).toBe("error");
    expect(reply.sources).toHaveLength(0);
    expect(reply.text).toMatch(/can't search/i);

    const user = await createUser();
    const svc = await createService({ slug: "fallback-test" });
    const tz = getConfig().BUSINESS_TIMEZONE;
    const day = addDaysToKey(todayKey(tz), 5, tz);
    const slot = await prisma.slot.create({ data: { serviceId: svc.id, startAt: zonedTime(day, "12:00", tz), endAt: zonedTime(day, "13:00", tz) } });
    actAs(user);
    const bookRes = await createBookingRoute(jsonRequest("/api/bookings", "POST", { slotId: slot.id }), undefined);
    expect(bookRes.status).toBe(201);
  });

  it("falls back to quoting documents (and says so) when only the LLM fails", async () => {
    setLlmForTests({
      name: "broken",
      model: "x",
      async complete() {
        throw new LlmError("timeout");
      },
    });
    const answer = await answerFromKnowledge("What are your opening hours on Saturday?");
    expect(answer.mode).toBe("extractive");
    expect(answer.notice).toMatch(/unavailable/i);
    expect(answer.sources[0].documentSlug).toBe("opening-hours");
  });
});
