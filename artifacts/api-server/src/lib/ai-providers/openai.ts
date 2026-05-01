import OpenAI from "openai";
import type { AIProviderClient, ChatMessage, ChatOptions, ChatResult } from "./types.js";

export class OpenAIProvider implements AIProviderClient {
  readonly name = "openai";
  readonly isFree = false;
  readonly defaultModel = "gpt-4o-mini";
  readonly smartModel = "gpt-4o";

  protected client: OpenAI;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY ?? "no-key";
    this.client = new OpenAI({ apiKey });
  }

  isAvailable(): boolean {
    return !!process.env.OPENAI_API_KEY;
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

