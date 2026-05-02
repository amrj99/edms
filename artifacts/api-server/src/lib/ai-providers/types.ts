/**
 * Pluggable AI Provider Architecture
 * ─────────────────────────────────────────────────────────────────────────────
 * Every provider must implement AIProviderClient.
 *
 * To add a new provider:
 *   1. Create a file in this directory implementing AIProviderClient
 *   2. Register it in index.ts (PROVIDERS map)
 *   3. Add its key to the ProviderKey union type below
 *   4. No changes needed in callAI() or any route
 */

export type ProviderCategory =
  | "cloud_free"   // Cloudflare Workers AI, HuggingFace — free, external cloud
  | "cloud_paid"   // OpenAI, Anthropic, Together AI — paid, external cloud
  | "aggregator"   // OpenRouter — routes to multiple underlying models
  | "local"        // Ollama — self-hosted, no external API calls
  | "fast";        // Groq — ultra-low latency inference

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface ChatResult {
  content: string;
  model: string;
  provider: string;
  tokensUsed?: number;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs?: number;
}

export interface AIProviderClient {
  readonly name: string;
  readonly isFree: boolean;
  readonly category: ProviderCategory;
  readonly defaultModel: string;
  readonly smartModel: string;
  /** Hardcoded model list for this provider. DB overrides are loaded via getModelsForProvider(). */
  getModels(): string[];
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult>;
  isAvailable(): boolean;
}

export type ProviderKey =
  | "cloudflare"    // Cloudflare Workers AI (free, OpenAI-compatible endpoint)
  | "groq"          // Groq Cloud (ultra-fast inference, free tier)
  | "openrouter"    // OpenRouter (routes to many free & paid models)
  | "huggingface"   // HuggingFace Inference API (free tier)
  | "together"      // Together AI (paid tier, high-quality open models)
  | "ollama"        // Local Ollama instance (self-hosted, no API key needed)
  | "openai"        // OpenAI direct (paid, GPT-4o family)
  | "anthropic"     // Anthropic Claude (paid, high reasoning quality)
  | "none";

export interface ProviderRegistry {
  [key: string]: AIProviderClient;
}
