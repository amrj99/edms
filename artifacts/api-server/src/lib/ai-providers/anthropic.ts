import type { AIProviderClient, ChatMessage, ChatOptions, ChatResult, ProviderCategory } from "./types.js";

const DEFAULT_MODELS = [
  "claude-3-haiku-20240307",
  "claude-3-5-sonnet-20241022",
  "claude-3-opus-20240229",
  "claude-3-5-haiku-20241022",
];

export class AnthropicProvider implements AIProviderClient {
  readonly name = "anthropic";
  readonly isFree = false;
  readonly category: ProviderCategory = "cloud_paid";
  readonly defaultModel = "claude-3-haiku-20240307";
  readonly smartModel = "claude-3-5-sonnet-20241022";

  isAvailable(): boolean {
    return !!process.env.ANTHROPIC_API_KEY;
  }

  getModels(): string[] {
    return DEFAULT_MODELS;
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
    const start = Date.now();
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

    const model = options.model ?? this.defaultModel;
    const systemPrompt = options.systemPrompt ?? "You are a helpful engineering document management assistant.";

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: options.maxTokens ?? 1024,
        system: systemPrompt,
        messages: messages.filter(m => m.role !== "system"),
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`Anthropic API error: ${err}`);
    }

    const data = await resp.json();
    const content = data.content?.[0]?.text ?? "";

    return {
      content,
      model,
      provider: this.name,
      tokensUsed: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
      promptTokens: data.usage?.input_tokens,
      completionTokens: data.usage?.output_tokens,
      latencyMs: Date.now() - start,
    };
  }
}
