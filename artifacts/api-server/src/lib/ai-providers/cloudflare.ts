import OpenAI from "openai";
import type { AIProviderClient, ChatMessage, ChatOptions, ChatResult, ProviderCategory } from "./types.js";

const DEFAULT_MODELS = [
  "@cf/meta/llama-3.2-3b-instruct",
  "@cf/mistral/mistral-7b-instruct-v0.1",
  "@cf/meta/llama-3.1-8b-instruct-fast",
  "@cf/google/gemma-7b-it",
  "@cf/meta/llama-3.2-11b-vision-instruct",
  "@cf/qwen/qwen1.5-14b-chat-awq",
];

export class CloudflareAIProvider implements AIProviderClient {
  readonly name = "cloudflare";
  readonly isFree = true;
  readonly category: ProviderCategory = "cloud_free";
  readonly defaultModel = "@cf/meta/llama-3.2-3b-instruct";
  readonly smartModel = "@cf/mistral/mistral-7b-instruct-v0.1";

  private client: OpenAI | null = null;

  private getClient(): OpenAI {
    if (this.client) return this.client;
    const accountId = process.env.CF_ACCOUNT_ID ?? "no-account";
    const apiKey = process.env.CF_AI_TOKEN ?? "no-key";
    this.client = new OpenAI({
      apiKey,
      baseURL: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`,
    });
    return this.client;
  }

  isAvailable(): boolean {
    return !!(process.env.CF_ACCOUNT_ID && process.env.CF_AI_TOKEN);
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

    const resp = await this.getClient().chat.completions.create({
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
