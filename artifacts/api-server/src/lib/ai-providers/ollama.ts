import OpenAI from "openai";
import type { AIProviderClient, ChatMessage, ChatOptions, ChatResult, ProviderCategory } from "./types.js";

const DEFAULT_MODELS = [
  "llama3.2",
  "llama3.1",
  "mistral",
  "codellama",
  "phi3",
  "gemma2",
];

export class OllamaProvider implements AIProviderClient {
  readonly name = "ollama";
  readonly isFree = true;
  readonly category: ProviderCategory = "local";
  readonly defaultModel = "llama3.2";
  readonly smartModel = "llama3.1";

  private client: OpenAI;

  constructor() {
    const baseURL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1";
    this.client = new OpenAI({ apiKey: "ollama", baseURL });
  }

  isAvailable(): boolean {
    return true;
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
      latencyMs: Date.now() - start,
    };
  }
}
