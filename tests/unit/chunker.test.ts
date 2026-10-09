import { describe, expect, it } from "vitest";
import { chunkDocument, normalizeText } from "@/server/rag/chunker";

const doc = `# Cancellation policy

Intro paragraph about the policy.

## Free cancellation
You can cancel free of charge up to 24 hours before.

## Late cancellations
${"Late cancellations are charged 50% of the price. ".repeat(30)}`;

describe("normalizeText", () => {
  it("normalises line endings, trailing spaces and blank-line runs but keeps paragraphs", () => {
    expect(normalizeText("﻿a  \r\nb\r\n\r\n\r\n\r\nc\u0007")).toBe("a\nb\n\nc");
  });
});

describe("chunkDocument", () => {
  const chunks = chunkDocument(doc, { chunkSize: 400, overlap: 60 });

  it("keeps the heading path as context on every chunk", () => {
    const free = chunks.find((c) => c.content.includes("free of charge"));
    expect(free?.headingPath).toBe("Cancellation policy › Free cancellation");
    expect(free?.content.startsWith("Cancellation policy › Free cancellation")).toBe(true);
  });

  it("never exceeds the configured chunk size", () => {
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(400);
  });

  it("splits long sections and overlaps consecutive chunks", () => {
    const late = chunks.filter((c) => c.headingPath.endsWith("Late cancellations"));
    expect(late.length).toBeGreaterThan(1);
    const tailOfFirst = late[0].content.slice(-30).trim();
    expect(late[1].content).toContain(tailOfFirst.split(" ").slice(-2).join(" "));
  });

  it("numbers chunks sequentially", () => {
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });

  it("is deterministic (same input → same chunks, so re-ingestion is stable)", () => {
    expect(chunkDocument(doc, { chunkSize: 400, overlap: 60 })).toEqual(chunks);
  });
});
