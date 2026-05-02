import type { AIProviderClient, ChatMessage, ChatOptions, ChatResult, ProviderCategory } from "./types.js";

const DEFAULT_MODELS = [
  "mistralai/Mistral-7B-Instruct-v0.3",
  "meta-llama/Meta-Llama-3-8B-Instruct",
  "HuggingFaceH4/zephyr-7b-beta",
  "microsoft/Phi-3-mini-4k-instruct",
];

export class HuggingFaceProvider implements AIProviderClient {
  readonly name = "huggingface";
  readonly isFree = true;
  readonly category: ProviderCategory = "cloud_free";
  readonly defaultModel = "mistralai/Mistral-7B-Instruct-v0.3";
  readonly smartModel = "meta-llama/Meta-Llama-3-8B-Instruct";

  isAvailable(): boolean {
    return !!process.env.HUGGINGFACE_API_KEY;
  }

  getModels(): string[] {
    return DEFAULT_MODELS;
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
    const start = Date.now();
    const apiKey = process.env.HUGGINGFACE_API_KEY;
    if (!apiKey) throw new Error("HUGGINGFACE_API_KEY not set");

    const model = options.model ?? this.defaultModel;
    const allMessages = options.systemPrompt
      ? [{ role: "system" as const, content: options.systemPrompt }, ...messages]
      : messages;

    const prompt = allMessages
      .map(m => `${m.role === "user" ? "User" : m.role === "system" ? "System" : "Assistant"}: ${m.content}`)
      .join("\n") + "\nAssistant:";

    const resp = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        inputs: prompt,
        parameters: {
          max_new_tokens: options.maxTokens ?? 512,
          temperature: options.temperature ?? 0.3,
          return_full_text: false,
        },
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`HuggingFace API error: ${err}`);
    }

    const data = await resp.json();
    const content = Array.isArray(data) ? (data[0]?.generated_text ?? "") : (data.generated_text ?? "");

    return { content: content.trim(), model, provider: this.name, latencyMs: Date.now() - start };
  }
}
