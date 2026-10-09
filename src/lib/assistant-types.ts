/** Wire types for POST /api/assistant/chat (shared by server and client). */
import type { BookingView } from "@/server/services/bookings";
import type { ServiceView } from "@/server/services/catalog";
import type { OpenSlot } from "@/server/services/availability";
import type { SourceRef } from "@/server/rag/generate";
import type { Intent } from "@/server/assistant/router";

export type { BookingView, ServiceView, OpenSlot, SourceRef, Intent };

export type AssistantMode = "llm" | "extractive" | "no_answer" | "error" | "tool" | "clarify";

export type AssistantReply = {
  id: string;
  intent: Intent;
  mode: AssistantMode;
  text: string;
  /** Explains degraded behaviour, e.g. the LLM being unavailable. */
  notice?: string;
  /** Knowledge answers only: how directly the retrieved passages match the question. */
  confidence?: "high" | "low" | "none";
  sources: SourceRef[];
  services?: ServiceView[];
  slots?: OpenSlot[];
  bookings?: BookingView[];
  /** A single slot the user asked for — booking happens only after explicit confirmation. */
  proposal?: OpenSlot;
  /** The booking the user asked to cancel — cancellation happens only after explicit confirmation. */
  cancellationTarget?: BookingView;
  suggestions?: string[];
  requiresSignIn?: boolean;
  timeZone: string;
};
