/**
 * AI Provider Factory
 * ────────────────────────────────────────────────────────────────────────────
 * Usage:
 *   const provider = getAIProvider({ orgProvider: "cloudflare", orgModel: "..." });
 *   const result   = await provider.chat([{ role: "user", content: "..." }]);
 *
 * To add a new provider:
 *   1. Create a file in this directory implementing AIProviderClient
 *   2. Register it in PROVIDERS below (one line)
 *   3. Add its key to the ProviderKey union type in types.ts
 *   — No changes needed in callAI() or any route —
 */

import { CloudflareAIProvider } from "./cloudflare.js";
import { GroqProvider }         from "./groq.js";
import { OpenRouterProvider }   from "./openrouter.js";
import { HuggingFaceProvider }  from "./huggingface.js";
import { TogetherAIProvider }   from "./together.js";
import { OllamaProvider }       from "./ollama.js";
import { OpenAIProvider }       from "./openai.js";
import { AnthropicProvider }    from "./anthropic.js";
import type { AIProviderClient, ProviderCategory, ProviderKey } from "./types.js";
import { db } from "@workspace/db";
import { orgConfigTable, systemSettingsTable, aiModelsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

export type { AIProviderClient, ChatMessage, ChatOptions, ChatResult, ProviderKey, ProviderCategory } from "./types.js";

// ─── Provider registry (singleton instances) ─────────────────────────────────
// To add a provider: add one line here + one entry in types.ts ProviderKey union.

const PROVIDERS: Record<string, AIProviderClient> = {
  cloudflare:  new CloudflareAIProvider(),
  groq:        new GroqProvider(),
  openrouter:  new OpenRouterProvider(),
  huggingface: new HuggingFaceProvider(),
  together:    new TogetherAIProvider(),
  ollama:      new OllamaProvider(),
  openai:      new OpenAIProvider(),
  anthropic:   new AnthropicProvider(),
};

/**
 * Priority order for automatic provider selection when none is configured.
 * Free/zero-cost providers come first.
 */
const FREE_PROVIDER_PRIORITY: ProviderKey[] = [
  "cloudflare",
  "groq",
  "openrouter",
  "together",
  "huggingface",
  "ollama",
];

// ─── Category metadata ────────────────────────────────────────────────────────

export const PROVIDER_CATEGORY_LABELS: Record<ProviderCategory, string> = {
  cloud_free: "Cloud — Free",
  fast:       "Cloud — Fast",
  aggregator: "Aggregator",
  cloud_paid: "Cloud — Paid",
  local:      "Local / Self-Hosted",
};

// ─── Public API ───────────────────────────────────────────────────────────────

export function getProviderByKey(key: string): AIProviderClient | null {
  return PROVIDERS[key] ?? null;
}

export function listProviders(): Array<{
  key: string;
  name: string;
  isFree: boolean;
  category: ProviderCategory;
  available: boolean;
  defaultModel: string;
  smartModel: string;
  models: string[];
}> {
  return Object.entries(PROVIDERS).map(([key, p]) => ({
    key,
    name:         p.name,
    isFree:       p.isFree,
    category:     p.category,
    available:    p.isAvailable(),
    defaultModel: p.defaultModel,
    smartModel:   p.smartModel,
    models:       p.getModels(),
  }));
}

/**
 * Get models for a provider.
 * Resolution order:
 *   1. Active rows in ai_models table for this provider (admin-managed)
 *   2. Hardcoded defaults from the provider class
 */
export async function getModelsForProvider(providerKey: string): Promise<string[]> {
  try {
    const rows = await db
      .select({ modelId: aiModelsTable.modelId })
      .from(aiModelsTable)
      .where(
        and(
          eq(aiModelsTable.provider, providerKey),
          eq(aiModelsTable.isActive, true),
        ),
      )
      .orderBy(aiModelsTable.tierMinimum, aiModelsTable.modelId);

    if (rows.length > 0) {
      return rows.map(r => r.modelId);
    }
  } catch {
    // Silently fall through to hardcoded defaults (table may not exist yet)
  }

  const provider = PROVIDERS[providerKey];
  return provider ? provider.getModels() : [];
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
    "Set CF_ACCOUNT_ID + CF_AI_TOKEN (Cloudflare) or OPENROUTER_API_KEY in your environment, " +
    "or configure a provider in Admin → AI Settings.",
  );
}

/**
 * Ordered list of free providers to try during automatic fallback.
 * Exported so ai-service.ts and ai-core.ts can reference the canonical order.
 */
export const FALLBACK_PROVIDER_CHAIN: ProviderKey[] = [
  "cloudflare",
  "groq",
  "openrouter",
  "together",
  "huggingface",
  "ollama",
];

/**
 * Call an AI provider with automatic fallback.
 * Tries each provider in `chain` order until one succeeds.
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
