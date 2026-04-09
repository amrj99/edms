import OpenAI from "openai";
import type { AIProviderClient, ChatMessage, ChatOptions, ChatResult } from "./types.js";

export class TogetherAIProvider implements AIProviderClient {
  readonly name = "together";
  readonly isFree = true;
  readonly defaultModel = "meta-llama/Llama-3.2-3B-Instruct-Turbo";
  readonly smartModel = "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo";

  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.TOGETHER_API_KEY ?? "no-key",
      baseURL: "https://api.together.xyz/v1",
    });
  }

  isAvailable(): boolean {
    return !!process.env.TOGETHER_API_KEY;
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
