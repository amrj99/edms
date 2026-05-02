import OpenAI from "openai";
import type { AIProviderClient, ChatMessage, ChatOptions, ChatResult, ProviderCategory } from "./types.js";

const DEFAULT_MODELS = [
  "llama-3.1-8b-instant",
  "llama-3.3-70b-versatile",
  "llama-3.2-3b-preview",
  "mixtral-8x7b-32768",
  "gemma2-9b-it",
];

export class GroqProvider implements AIProviderClient {
  readonly name = "groq";
  readonly isFree = true;
  readonly category: ProviderCategory = "fast";
  readonly defaultModel = "llama-3.1-8b-instant";
  readonly smartModel = "llama-3.3-70b-versatile";

  private client: OpenAI;

  constructor() {
    const apiKey = process.env.GROQ_API_KEY ?? "no-key";
    this.client = new OpenAI({ apiKey, baseURL: "https://api.groq.com/openai/v1" });
  }

  isAvailable(): boolean {
    return !!process.env.GROQ_API_KEY;
  }

  getModels(): string[] {
    return DEFAULT_MODELS;
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
    const start = Date.now();
    const model = options.model ?? this.defaultModel;

    const msgs = options.systemPrompt
      ? [{ role: "system" as const, content: options.systemPrompt }, ...messages]
      : messages;

    const resp = await this.client.chat.completions.create({
      model,
      messages: msgs,
      max_tokens: options.maxTokens ?? 1024,
      temperature: options.temperature ?? 0.3,
    });

    return {
      content: resp.choices[0]?.message?.content ?? "",
      model,
      provider: this.name,
      tokensUsed: resp.usage?.total_tokens,
      promptTokens: resp.usage?.prompt_tokens,
      completionTokens: resp.usage?.completion_tokens,
      latencyMs: Date.now() - start,
    };
  }
}
