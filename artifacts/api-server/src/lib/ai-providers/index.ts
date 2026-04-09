/**
 * AI Provider Factory
 * ────────────────────────────────────────────────────────────────────────────
 * Usage:
 *   const provider = getAIProvider({ orgProvider: "openrouter", orgModel: "..." });
 *   const result   = await provider.chat([{ role: "user", content: "..." }]);
 *
 * To add a new provider:
 *   1. Create a file in this directory that implements AIProviderClient
 *   2. Register it in PROVIDERS below
 *   3. Add its key to the ProviderKey union type in types.ts
 */

import { OpenRouterProvider }   from "./openrouter.js";
import { HuggingFaceProvider }  from "./huggingface.js";
import { TogetherAIProvider }   from "./together.js";
import { OllamaProvider }       from "./ollama.js";
import { OpenAIProvider, OpenAIReplitProvider } from "./openai.js";
import { AnthropicProvider }    from "./anthropic.js";
import { GroqProvider }         from "./groq.js";
import type { AIProviderClient, ProviderKey } from "./types.js";
import { db } from "@workspace/db";
import { orgConfigTable, systemSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type { AIProviderClient, ChatMessage, ChatOptions, ChatResult, ProviderKey } from "./types.js";

// ─── Provider registry (singleton instances) ─────────────────────────────────

const PROVIDERS: Record<string, AIProviderClient> = {
  openrouter:    new OpenRouterProvider(),
  huggingface:   new HuggingFaceProvider(),
  together:      new TogetherAIProvider(),
  ollama:        new OllamaProvider(),
  openai:        new OpenAIProvider(),
  openai_replit: new OpenAIReplitProvider(),
  anthropic:     new AnthropicProvider(),
  groq:          new GroqProvider(),
};

/**
 * Priority order for automatic provider selection when none is configured.
 * Free providers come first; paid providers only if explicitly configured.
 */
const FREE_PROVIDER_PRIORITY: ProviderKey[] = [
  "openrouter",
  "together",
  "huggingface",
  "ollama",
];

// ─── Public API ───────────────────────────────────────────────────────────────

export function getProviderByKey(key: string): AIProviderClient | null {
  return PROVIDERS[key] ?? null;
}

export function listProviders(): Array<{
  key: string;
  name: string;
  isFree: boolean;
  available: boolean;
  defaultModel: string;
  smartModel: string;
}> {
  return Object.entries(PROVIDERS).map(([key, p]) => ({
    key,
    name: p.name,
    isFree: p.isFree,
    available: p.isAvailable(),
    defaultModel: p.defaultModel,
    smartModel: p.smartModel,
  }));
}

/**
 * Get the best available provider for an organization.
 * Resolution order:
 *   1. Org-level aiProvider setting (from org_config)
 *   2. System-level ai_provider setting (from system_settings)
 *   3. First available free provider (by FREE_PROVIDER_PRIORITY)
 *   4. Throws if nothing is available
 */
export async function getAIProviderForOrg(organizationId?: number | null): Promise<AIProviderClient> {
  // 1. Org-level override
  if (organizationId) {
    const [cfg] = await db.select().from(orgConfigTable)
      .where(eq(orgConfigTable.organizationId, organizationId));
    if (cfg?.aiProvider && cfg.aiProvider !== "none") {
      const p = PROVIDERS[cfg.aiProvider];
      if (p?.isAvailable()) return p;
    }
  }

  // 2. System-level fallback
  const rows = await db.select().from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, "ai_provider"));
  const sysProvider = rows[0]?.value;
  if (sysProvider && sysProvider !== "none") {
    const p = PROVIDERS[sysProvider];
    if (p?.isAvailable()) return p;
  }

  // 3. Auto-select first available free provider
  for (const key of FREE_PROVIDER_PRIORITY) {
    const p = PROVIDERS[key];
    if (p?.isAvailable()) return p;
  }

  throw new Error(
    "No AI provider is configured or available. " +
    "Set OPENROUTER_API_KEY, TOGETHER_API_KEY, or HUGGINGFACE_API_KEY in your environment, " +
    "or configure a provider in Admin → AI Settings.",
  );
}

/**
 * Ordered list of free providers to try during automatic fallback.
 * This is exported so ai-service.ts can reference the canonical order.
 */
export const FALLBACK_PROVIDER_CHAIN: ProviderKey[] = [
  "openrouter",
  "together",
  "huggingface",
  "ollama",
];

/**
 * Call an AI provider with automatic fallback.
 *
 * Tries each provider in `chain` order until one succeeds.
 * If `chain` is not provided, uses FALLBACK_PROVIDER_CHAIN.
 * Returns the first successful result along with the provider key used.
 *
 * Transparent fallback — never throws if at least one provider succeeds.
 */
export async function callWithFallback(
  messages: import("./types.js").ChatMessage[],
  options?: import("./types.js").ChatOptions,
  chain?: string[],
): Promise<{ result: import("./types.js").ChatResult; provider: string; model: string }> {
  const tryChain = chain ?? FALLBACK_PROVIDER_CHAIN;
  let lastError: Error | null = null;

  for (const key of tryChain) {
    const p = PROVIDERS[key];
    if (!p?.isAvailable()) continue;

    const model = options?.model ?? p.defaultModel;
    try {
      const result = await p.chat(messages, { ...options, model });
      return { result, provider: key, model };
    } catch (err: any) {
      lastError = err as Error;
    }
  }

  throw lastError ?? new Error("All providers in fallback chain failed or unavailable");
}

/**
 * Get effective model for an org, falling back to provider defaults.
 */
export async function getEffectiveModel(
  organizationId: number | null | undefined,
  tier: "fast" | "smart" = "fast",
): Promise<{ provider: AIProviderClient; model: string }> {
  const provider = await getAIProviderForOrg(organizationId);

  // Check org-level model override
  if (organizationId) {
    const [cfg] = await db.select().from(orgConfigTable)
      .where(eq(orgConfigTable.organizationId, organizationId));
    const orgModel = cfg?.aiModel;
    if (orgModel) return { provider, model: orgModel };
  }

  // Check system-level model setting
  const key = tier === "smart" ? "ai_smart_model" : "ai_fast_model";
  const rows = await db.select().from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, key));
  const sysModel = rows[0]?.value;
  if (sysModel) return { provider, model: sysModel };

  // Provider default
  const model = tier === "smart" ? provider.smartModel : provider.defaultModel;
  return { provider, model };
}
