import OpenAI from "openai";
import type { AIProviderClient, ChatMessage, ChatOptions, ChatResult, ProviderCategory } from "./types.js";

const DEFAULT_MODELS = [
  "meta-llama/llama-3.2-3b-instruct:free",
  "mistralai/mistral-7b-instruct:free",
  "google/gemma-2-9b-it:free",
  "microsoft/phi-3-mini-128k-instruct:free",
  "meta-llama/llama-3.1-8b-instruct:free",
  "qwen/qwen-2-7b-instruct:free",
];

export class OpenRouterProvider implements AIProviderClient {
  readonly name = "openrouter";
  readonly isFree = true;
  readonly category: ProviderCategory = "aggregator";
  readonly defaultModel = "meta-llama/llama-3.2-3b-instruct:free";
  readonly smartModel = "mistralai/mistral-7b-instruct:free";

  private client: OpenAI;

  constructor() {
    const apiKey = process.env.OPENROUTER_API_KEY ?? "no-key";
    this.client = new OpenAI({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": process.env.APP_URL ?? "https://arcscale.app",
        "X-Title": "ArcScale EDMS",
      },
    });
  }

  isAvailable(): boolean {
    return !!process.env.OPENROUTER_API_KEY;
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
