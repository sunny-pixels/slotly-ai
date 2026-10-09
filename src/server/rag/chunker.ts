/**
 * Structure-aware text chunking for the knowledge base.
 *
 * 1. Normalise whitespace without destroying structure (paragraphs, lists, headings).
 * 2. Split Markdown into sections at headings, remembering the heading path
 *    ("Cancellation policy › Late cancellations") so each chunk carries context.
 * 3. Pack paragraphs into chunks of at most `chunkSize` characters; oversized
 *    paragraphs fall back to sentence, then hard, splitting.
 * 4. Consecutive chunks of the same section overlap by ~`overlap` characters.
 */

export type ChunkOptions = { chunkSize: number; overlap: number };

export type TextChunk = {
  index: number;
  content: string;
  headingPath: string;
  tokenEstimate: number;
};

export function normalizeText(input: string): string {
  return (
    input
      .replace(/^﻿/, "")
      .replace(/\r\n?/g, "\n")
      // strip control characters except tab and newline
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      .replace(/[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** Rough token estimate (≈4 characters per token for English prose). */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

type Section = { headingPath: string; body: string };

function splitSections(text: string): Section[] {
  const lines = text.split("\n");
  const stack: { level: number; title: string }[] = [];
  const sections: Section[] = [];
  let buffer: string[] = [];

  const flush = () => {
    const body = buffer.join("\n").trim();
    if (body) sections.push({ headingPath: stack.map((s) => s.title).join(" › "), body });
    buffer = [];
  };

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) {
      flush();
      const level = match[1].length;
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, title: match[2].trim() });
    } else {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

function splitSentences(paragraph: string): string[] {
  return paragraph.match(/[^.!?]+(?:[.!?]+["')\]]*|$)\s*/g)?.map((s) => s.trim()).filter(Boolean) ?? [paragraph];
}

function hardSplit(text: string, size: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf(" ", size);
    if (cut < size * 0.5) cut = size;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Breaks text into pieces no longer than `size`, preferring paragraph then sentence boundaries. */
function atomicPieces(body: string, size: number): string[] {
  const pieces: string[] = [];
  for (const paragraph of body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)) {
    if (paragraph.length <= size) {
      pieces.push(paragraph);
      continue;
    }
    for (const sentence of splitSentences(paragraph)) {
      if (sentence.length <= size) pieces.push(sentence);
      else pieces.push(...hardSplit(sentence, size));
    }
  }
  return pieces;
}

function overlapTail(text: string, overlap: number): string {
  if (overlap <= 0 || text.length <= overlap) return overlap > 0 ? text : "";
  const tail = text.slice(-overlap);
  const firstSpace = tail.indexOf(" ");
  return (firstSpace > 0 ? tail.slice(firstSpace + 1) : tail).trim();
}

export function chunkDocument(text: string, options: ChunkOptions): TextChunk[] {
  const chunkSize = Math.max(100, options.chunkSize);
  const overlap = Math.max(0, Math.min(options.overlap, Math.floor(chunkSize / 2)));
  const normalized = normalizeText(text);
  const chunks: TextChunk[] = [];

  for (const section of splitSections(normalized)) {
    const prefix = section.headingPath ? `${section.headingPath}\n\n` : "";
    const budget = Math.max(80, chunkSize - prefix.length);
    const pieces = atomicPieces(section.body, budget);

    let current = "";
    const emit = () => {
      const body = current.trim();
      if (!body) return;
      const content = `${prefix}${body}`;
      chunks.push({ index: chunks.length, content, headingPath: section.headingPath, tokenEstimate: estimateTokens(content) });
    };

    for (const piece of pieces) {
      const candidate = current ? `${current}\n\n${piece}` : piece;
      if (candidate.length <= budget) {
        current = candidate;
        continue;
      }
      emit();
      const tail = overlapTail(current, overlap);
      current = tail && tail.length + piece.length + 2 <= budget ? `${tail}\n\n${piece}` : piece;
    }
    emit();
  }
  return chunks;
}
