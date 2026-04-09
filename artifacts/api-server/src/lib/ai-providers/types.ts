/**
 * Pluggable AI Provider Architecture
 * Every provider must implement AIProviderClient.
 * Add new providers by implementing this interface and registering in index.ts.
 */

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
  readonly defaultModel: string;
  readonly smartModel: string;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult>;
  isAvailable(): boolean;
}

export type ProviderKey =
  | "openrouter"    // free models via OpenRouter (default)
  | "huggingface"   // HuggingFace Inference API (free tier)
  | "together"      // Together AI (free tier)
  | "ollama"        // Local Ollama instance
  | "openai"        // OpenAI paid (optional)
  | "anthropic"     // Anthropic paid (optional)
  | "openai_replit" // Legacy Replit OpenAI proxy
  | "groq"          // Groq (legacy)
  | "none";

export interface ProviderRegistry {
  [key: string]: AIProviderClient;
}
