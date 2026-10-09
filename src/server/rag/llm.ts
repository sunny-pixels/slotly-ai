import { getConfig } from "@/lib/config";

/**
 * Minimal LLM client for free-tier providers, using plain fetch (no SDKs).
 * Keys are read from server-side env vars only and never reach the browser.
 */
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type LlmResult = {
  text: string;
  usage?: { promptTokens?: number; completionTokens?: number };
};

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete(messages: ChatMessage[], opts?: { json?: boolean; maxTokens?: number; temperature?: number }): Promise<LlmResult>;
}

export class LlmError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LlmError";
  }
}

class GroqProvider implements LlmProvider {
  readonly name = "groq";
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly timeoutMs: number,
  ) {}

  async complete(messages: ChatMessage[], opts: { json?: boolean; maxTokens?: number; temperature?: number } = {}) {
    let res: Response;
    try {
      res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: opts.temperature ?? 0.1,
          max_tokens: opts.maxTokens ?? 700,
          ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new LlmError("Groq did not respond in time.", { cause: error });
    }
    if (!res.ok) throw new LlmError(`Groq request failed with HTTP ${res.status}.`);
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new LlmError("Groq returned an empty response.");
    return { text, usage: { promptTokens: data.usage?.prompt_tokens, completionTokens: data.usage?.completion_tokens } };
  }
}

class GeminiProvider implements LlmProvider {
  readonly name = "gemini";
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly timeoutMs: number,
  ) {}

  async complete(messages: ChatMessage[], opts: { json?: boolean; maxTokens?: number; temperature?: number } = {}) {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
    let res: Response;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
          body: JSON.stringify({
            ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
            contents,
            generationConfig: {
              temperature: opts.temperature ?? 0.1,
              maxOutputTokens: opts.maxTokens ?? 700,
              ...(opts.json ? { responseMimeType: "application/json" } : {}),
            },
          }),
          signal: AbortSignal.timeout(this.timeoutMs),
        },
      );
    } catch (error) {
      throw new LlmError("Gemini did not respond in time.", { cause: error });
    }
    if (!res.ok) throw new LlmError(`Gemini request failed with HTTP ${res.status}.`);
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
    if (!text) throw new LlmError("Gemini returned an empty response.");
    return {
      text,
      usage: { promptTokens: data.usageMetadata?.promptTokenCount, completionTokens: data.usageMetadata?.candidatesTokenCount },
    };
  }
}

let override: LlmProvider | null | undefined;

/** Returns the configured provider, or null when LLM generation is disabled / unconfigured. */
export function getLlm(): LlmProvider | null {
  if (override !== undefined) return override;
  const config = getConfig();
  if (config.LLM_PROVIDER === "groq" && config.GROQ_API_KEY) {
    return new GroqProvider(config.GROQ_API_KEY, config.GROQ_MODEL, config.LLM_TIMEOUT_MS);
  }
  if (config.LLM_PROVIDER === "gemini" && config.GEMINI_API_KEY) {
    return new GeminiProvider(config.GEMINI_API_KEY, config.GEMINI_MODEL, config.LLM_TIMEOUT_MS);
  }
  return null;
}

/** Test hook: `undefined` restores env-based selection, `null` disables the LLM. */
export function setLlmForTests(p: LlmProvider | null | undefined) {
  override = p;
}

/** Extracts the first JSON object from model output (tolerates code fences). */
export function parseJsonObject(text: string): unknown {
  const fenced = text.replace(/```(?:json)?/gi, "");
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  if (start === -1 || end <= start) throw new LlmError("The model did not return JSON.");
  try {
    return JSON.parse(fenced.slice(start, end + 1));
  } catch (error) {
    throw new LlmError("The model returned malformed JSON.", { cause: error });
  }
}
