/**
 * EDMS AI Service
 * Multi-provider AI with automatic fallback: configured provider → OpenRouter → Together → HuggingFace → Ollama.
 * Provider/models are configurable from the admin AI Settings dashboard.
 * All calls are logged with provider, model, tokens, latency, and success/failure.
 */
import OpenAI from "openai";
import { db } from "@workspace/db";
import { aiCacheTable, aiLogsTable, aiSettingsTable, systemSettingsTable, orgConfigTable } from "@workspace/db";
import { and, eq, gt, gte, isNull, sql } from "drizzle-orm";
import { logger } from "./logger.js";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ─── Provider types ───────────────────────────────────────────────────────────

export type AIProvider =
  | "openrouter"    // free default: OpenRouter free models
  | "huggingface"   // free: HuggingFace Inference API
  | "together"      // free: Together AI free tier
  | "ollama"        // self-hosted local Ollama
  | "openai"        // paid optional: OpenAI direct
  | "anthropic"     // paid optional: Anthropic Claude
  | "openai_replit" // legacy: Replit OpenAI proxy
  | "groq"          // legacy: Groq Cloud
  | "none";

export interface AIProviderConfig {
  provider: AIProvider;
  fastModel: string;
  smartModel: string;
}

const PROVIDER_DEFAULTS: Record<AIProvider, { fastModel: string; smartModel: string }> = {
  openrouter:    { fastModel: "meta-llama/llama-3.2-3b-instruct:free", smartModel: "mistralai/mistral-7b-instruct:free" },
  huggingface:   { fastModel: "mistralai/Mistral-7B-Instruct-v0.3",   smartModel: "meta-llama/Meta-Llama-3-8B-Instruct" },
  together:      { fastModel: "meta-llama/Llama-3.2-3B-Instruct-Turbo", smartModel: "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo" },
  openai_replit: { fastModel: "gpt-4o-mini",              smartModel: "gpt-4o" },
  groq:          { fastModel: "llama-3.1-8b-instant",      smartModel: "llama-3.3-70b-versatile" },
  ollama:        { fastModel: "llama3.2",                  smartModel: "llama3.1" },
  openai:        { fastModel: "gpt-4o-mini",               smartModel: "gpt-4o" },
  anthropic:     { fastModel: "claude-3-haiku-20240307",   smartModel: "claude-3-5-sonnet-20241022" },
  none:          { fastModel: "",                          smartModel: "" },
};

// ─── Dynamic AI client ────────────────────────────────────────────────────────

let _cachedClient: OpenAI | null = null;
let _cachedProvider: string | null = null;

async function getSystemSettingValue(key: string): Promise<string | null> {
  const rows = await db.select().from(systemSettingsTable).where(eq(systemSettingsTable.key, key));
  return rows[0]?.value ?? null;
}

export async function getAIProviderConfig(): Promise<AIProviderConfig> {
  // Default to openrouter (free) when no provider is configured.
  const provider = (await getSystemSettingValue("ai_provider") ?? "openrouter") as AIProvider;
  const defaults = PROVIDER_DEFAULTS[provider] ?? PROVIDER_DEFAULTS.openrouter;
  const fastModel  = await getSystemSettingValue("ai_fast_model")  ?? defaults.fastModel;
  const smartModel = await getSystemSettingValue("ai_smart_model") ?? defaults.smartModel;
  return { provider, fastModel, smartModel };
}

export async function getAIClient(): Promise<OpenAI> {
  const { provider } = await getAIProviderConfig();

  if (_cachedClient && _cachedProvider === provider) return _cachedClient;

  // Reset cache when provider changes
  _cachedClient = null;
  _cachedProvider = provider;

  if (provider === "none") {
    throw new Error("AI provider is set to 'none'. Enable an AI provider in Admin → AI Settings.");
  } else if (provider === "openrouter") {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set. Get a free key at https://openrouter.ai/keys");
    _cachedClient = new OpenAI({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": process.env.APP_URL ?? "https://arcscale.app",
        "X-Title": "ArcScale EDMS",
      },
    });
  } else if (provider === "together") {
    const apiKey = process.env.TOGETHER_API_KEY;
    if (!apiKey) throw new Error("TOGETHER_API_KEY is not set. Get a free key at https://api.together.ai");
    _cachedClient = new OpenAI({ apiKey, baseURL: "https://api.together.xyz/v1" });
  } else if (provider === "groq") {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY is not set. Add it to your environment or .env file.");
    _cachedClient = new OpenAI({ apiKey, baseURL: "https://api.groq.com/openai/v1" });
  } else if (provider === "ollama") {
    const baseURL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1";
    _cachedClient = new OpenAI({ apiKey: "ollama", baseURL });
  } else if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");
    _cachedClient = new OpenAI({ apiKey });
  } else {
    // openai_replit (default / legacy)
    const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const apiKey  = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    if (!baseURL || !apiKey) {
      throw new Error(
        "OpenAI Replit proxy not configured. " +
        "For production VPS use: set OPENROUTER_API_KEY, TOGETHER_API_KEY, or OPENAI_API_KEY " +
        "and switch the provider in Admin → AI Settings.",
      );
    }
    _cachedClient = new OpenAI({ apiKey, baseURL });
  }

  return _cachedClient;
}

export async function updateAIProviderConfig(config: Partial<AIProviderConfig>) {
  const upsert = async (key: string, value: string) => {
    const existing = await db.select().from(systemSettingsTable).where(eq(systemSettingsTable.key, key));
    if (existing.length > 0) {
      await db.update(systemSettingsTable).set({ value, updatedAt: new Date() }).where(eq(systemSettingsTable.key, key));
    } else {
      await db.insert(systemSettingsTable).values({ key, value });
    }
  };

  if (config.provider !== undefined) {
    await upsert("ai_provider", config.provider);
    // Reset client cache so next call picks up new provider
    _cachedClient = null;
    _cachedProvider = null;
    // Reset model settings to provider defaults when switching providers
    const defaults = PROVIDER_DEFAULTS[config.provider];
    if (defaults) {
      if (config.fastModel === undefined)  await upsert("ai_fast_model",  defaults.fastModel);
      if (config.smartModel === undefined) await upsert("ai_smart_model", defaults.smartModel);
    }
  }
  if (config.fastModel  !== undefined) await upsert("ai_fast_model",  config.fastModel);
  if (config.smartModel !== undefined) await upsert("ai_smart_model", config.smartModel);
}

export function getProviderStatus() {
  return {
    // ── Free providers (recommended for production VPS) ───────────────────────
    openrouter: {
      configured: !!process.env.OPENROUTER_API_KEY,
      isFree: true,
      label: "OpenRouter (Free Models — Recommended)",
      description: "Access free open-source models (Llama 3, Mistral, Gemma). Get a free API key at openrouter.ai.",
      envVarsRequired: ["OPENROUTER_API_KEY"],
      docsUrl: "https://openrouter.ai/keys",
    },
    huggingface: {
      configured: !!process.env.HUGGINGFACE_API_KEY,
      isFree: true,
      label: "HuggingFace Inference API (Free Tier)",
      description: "Run Mistral, Llama, and thousands of open-source models via HuggingFace. Free tier available.",
      envVarsRequired: ["HUGGINGFACE_API_KEY"],
      docsUrl: "https://huggingface.co/settings/tokens",
    },
    together: {
      configured: !!process.env.TOGETHER_API_KEY,
      isFree: true,
      label: "Together AI (Free Tier)",
      description: "Fast inference for open-source models. Free tier with generous quota.",
      envVarsRequired: ["TOGETHER_API_KEY"],
      docsUrl: "https://api.together.ai",
    },
    ollama: {
      configured: true,
      isFree: true,
      label: "Ollama (Local / Self-Hosted)",
      description: "Run open-source models locally on the same server. No API key needed. Requires Ollama installed.",
      envVarsRequired: ["OLLAMA_BASE_URL"],
      docsUrl: "https://ollama.com",
    },
    // ── Paid providers (optional, for higher accuracy) ─────────────────────────
    openai: {
      configured: !!process.env.OPENAI_API_KEY,
      isFree: false,
      label: "OpenAI (Paid — GPT-4o)",
      description: "Highest accuracy. Requires paid OpenAI account. Set OPENAI_API_KEY.",
      envVarsRequired: ["OPENAI_API_KEY"],
      docsUrl: "https://platform.openai.com/api-keys",
    },
    anthropic: {
      configured: !!process.env.ANTHROPIC_API_KEY,
      isFree: false,
      label: "Anthropic Claude (Paid)",
      description: "Claude models for high-quality reasoning. Requires paid Anthropic account.",
      envVarsRequired: ["ANTHROPIC_API_KEY"],
      docsUrl: "https://console.anthropic.com",
    },
    // ── Legacy providers ───────────────────────────────────────────────────────
    openai_replit: {
      configured: !!(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL && process.env.AI_INTEGRATIONS_OPENAI_API_KEY),
      isFree: true,
      label: "OpenAI via Replit Proxy (Development Only)",
      description: "Replit-managed OpenAI proxy. Only works inside the Replit environment, not on VPS.",
      envVarsRequired: ["AI_INTEGRATIONS_OPENAI_BASE_URL", "AI_INTEGRATIONS_OPENAI_API_KEY"],
      docsUrl: null,
    },
    groq: {
      configured: !!process.env.GROQ_API_KEY,
      isFree: false,
      label: "Groq Cloud",
      description: "Ultra-fast inference for open-source models. Free tier available at console.groq.com.",
      envVarsRequired: ["GROQ_API_KEY"],
      docsUrl: "https://console.groq.com",
    },
    // ── Disable AI ─────────────────────────────────────────────────────────────
    none: {
      configured: true,
      isFree: true,
      label: "None (Disable AI Features)",
      description: "Disables all AI features. Rules engine and manual workflows continue to work normally.",
      envVarsRequired: [],
      docsUrl: null,
    },
  };
}

// ─── Subscription tier definitions ──────────────────────────────────────────

export const SUBSCRIPTION_TIERS = {
  free:         { aiProvider: "none",        aiModel: null,                                        aiDailyLimit: 0 },
  basic:        { aiProvider: "openrouter",  aiModel: "meta-llama/llama-3.2-3b-instruct:free",    aiDailyLimit: 30 },
  professional: { aiProvider: "openrouter",  aiModel: "mistralai/mistral-7b-instruct:free",        aiDailyLimit: 500 },
  enterprise:   { aiProvider: "openrouter",  aiModel: null,                                        aiDailyLimit: 0 },
} as const;

export type SubscriptionTier = keyof typeof SUBSCRIPTION_TIERS;

// ─── Per-org AI quota ─────────────────────────────────────────────────────────

export interface OrgAiQuota {
  provider: string | null;           // org-level override or null (inherits global)
  model: string | null;              // org-level model override or null
  dailyLimit: number;                // 0 = unlimited
  usedToday: number;                 // successful AI calls since 00:00 UTC today
  remaining: number | null;          // null = unlimited; otherwise dailyLimit - usedToday
  monthlyTokenLimit: number;         // 0 = unlimited
  usedTokensThisMonth: number;       // total tokens consumed since 1st of current month
  remainingTokens: number | null;    // null = unlimited; otherwise monthlyTokenLimit - usedTokensThisMonth
}

export async function getOrgAiQuota(organizationId: number): Promise<OrgAiQuota> {
  const [cfg] = await db
    .select({
      aiProvider:          orgConfigTable.aiProvider,
      aiModel:             orgConfigTable.aiModel,
      aiDailyLimit:        orgConfigTable.aiDailyLimit,
      aiMonthlyTokenLimit: orgConfigTable.aiMonthlyTokenLimit,
    })
    .from(orgConfigTable)
    .where(eq(orgConfigTable.organizationId, organizationId));

  const provider           = cfg?.aiProvider          ?? null;
  const model              = cfg?.aiModel             ?? null;
  const dailyLimit         = cfg?.aiDailyLimit        ?? 0;
  const monthlyTokenLimit  = cfg?.aiMonthlyTokenLimit ?? 0;

  // Count successful calls today
  const todayUtc = new Date();
  todayUtc.setUTCHours(0, 0, 0, 0);

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(aiLogsTable)
    .where(and(
      eq(aiLogsTable.organizationId, organizationId),
      eq(aiLogsTable.success, true),
      gte(aiLogsTable.createdAt, todayUtc),
    ));

  // Sum tokens consumed this month
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const [tokenRow] = await db
    .select({ total: sql<number>`coalesce(sum(tokens_used), 0)::int` })
    .from(aiLogsTable)
    .where(and(
      eq(aiLogsTable.organizationId, organizationId),
      eq(aiLogsTable.success, true),
      gte(aiLogsTable.createdAt, startOfMonth),
    ));

  const usedToday          = Number(countRow?.count ?? 0);
  const usedTokensThisMonth = Number(tokenRow?.total ?? 0);
  const remaining          = dailyLimit > 0 ? Math.max(0, dailyLimit - usedToday) : null;
  const remainingTokens    = monthlyTokenLimit > 0 ? Math.max(0, monthlyTokenLimit - usedTokensThisMonth) : null;

  return { provider, model, dailyLimit, usedToday, remaining, monthlyTokenLimit, usedTokensThisMonth, remainingTokens };
}

// ─── Build a one-shot AI client for a specific provider (no global cache) ────

async function buildProviderClient(provider: string): Promise<OpenAI | null> {
  if (provider === "openrouter") {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) { logger.warn("Org uses openrouter but OPENROUTER_API_KEY is not set"); return null; }
    return new OpenAI({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: { "HTTP-Referer": process.env.APP_URL ?? "https://arcscale.app", "X-Title": "ArcScale EDMS" },
    });
  }
  if (provider === "together") {
    const apiKey = process.env.TOGETHER_API_KEY;
    if (!apiKey) { logger.warn("Org uses together but TOGETHER_API_KEY is not set"); return null; }
    return new OpenAI({ apiKey, baseURL: "https://api.together.xyz/v1" });
  }
  if (provider === "groq") {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) { logger.warn("Org uses groq provider but GROQ_API_KEY is not set"); return null; }
    return new OpenAI({ apiKey, baseURL: "https://api.groq.com/openai/v1" });
  }
  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY
      ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    if (!apiKey) { logger.warn("Org uses openai but no OPENAI_API_KEY set"); return null; }
    const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    return new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  }
  if (provider === "ollama") {
    const baseURL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1";
    return new OpenAI({ apiKey: "ollama", baseURL });
  }
  if (provider === "openai_replit") {
    const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const apiKey  = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    if (!baseURL || !apiKey) { logger.warn("Org uses openai_replit but Replit proxy is not configured"); return null; }
    return new OpenAI({ apiKey, baseURL });
  }
  return null;
}

// ─── Fallback chain & core AI call ────────────────────────────────────────────

/** Transparent fallback order when the primary provider fails. */
const FALLBACK_CHAIN: string[] = ["openrouter", "together", "huggingface", "ollama"];

/** Result returned by callAI — includes metadata for structured logging. */
export interface AICallResult {
  data: unknown;
  provider: string;
  model: string;
  tokensUsed?: number;
  latencyMs: number;
  usedFallback: boolean;
}

/**
 * Execute a single chat completion on a specific provider.
 * HuggingFace uses its own API class; all other providers are OpenAI-compatible.
 */
async function executeOnProvider(
  providerKey: string,
  model: string,
  systemPrompt: string,
  prompt: string,
): Promise<{ content: string; tokensUsed?: number; latencyMs: number }> {
  const start = Date.now();

  if (providerKey === "huggingface") {
    const { getProviderByKey } = await import("./ai-providers/index.js");
    const hf = getProviderByKey("huggingface");
    if (!hf?.isAvailable()) throw new Error("HuggingFace provider not available (missing HUGGINGFACE_API_KEY)");
    const res = await hf.chat(
      [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }],
      { model },
    );
    return { content: res.content, tokensUsed: res.tokensUsed, latencyMs: res.latencyMs ?? Date.now() - start };
  }

  const client = await buildProviderClient(providerKey);
  if (!client) throw new Error(`Provider '${providerKey}' is not configured (missing API key)`);

  const response = await client.chat.completions.create({
    model,
    max_completion_tokens: 8192,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: prompt },
    ],
  });

  return {
    content:    response.choices[0]?.message?.content ?? "",
    tokensUsed: response.usage?.total_tokens,
    latencyMs:  Date.now() - start,
  };
}

/** Parse JSON from AI output, stripping markdown fences if present. */
function parseAIContent(content: string, jsonMode: boolean): unknown {
  if (!jsonMode) return content;
  const safe = (content === null || content === undefined || content === "") ? "{}" : content;
  try {
    const match = safe.match(/```json\s*([\s\S]*?)```/) || safe.match(/```\s*([\s\S]*?)```/);
    return JSON.parse(match ? match[1].trim() : safe.trim());
  } catch {
    logger.warn({ content: safe.substring(0, 200) }, "Failed to parse AI JSON response");
    return { raw: safe };
  }
}

// ─── Cache helpers ───────────────────────────────────────────────────────────

async function getCache(
  entityType: string,
  entityId: number,
  analysisType: string,
  organizationId?: number | null,
) {
  const rows = await db.select().from(aiCacheTable).where(
    and(
      eq(aiCacheTable.entityType, entityType),
      eq(aiCacheTable.entityId, entityId),
      eq(aiCacheTable.analysisType, analysisType),
      gt(aiCacheTable.expiresAt, new Date()),
      // Org-scoped lookup: if orgId provided match it; otherwise allow any (system entries)
      organizationId != null
        ? eq(aiCacheTable.organizationId, organizationId)
        : undefined,
    )
  ).limit(1);
  return rows[0]?.result ?? null;
}

async function setCache(
  entityType: string,
  entityId: number,
  analysisType: string,
  result: unknown,
  model: string,
  organizationId?: number | null,
) {
  const expiresAt = new Date(Date.now() + CACHE_TTL_MS);

  if (organizationId != null) {
    // Org-scoped upsert — full 4-column unique key is well-defined (no NULLs in key)
    await db.insert(aiCacheTable).values({
      organizationId, entityType, entityId, analysisType, result: result as any, model, expiresAt,
    }).onConflictDoUpdate({
      target: [aiCacheTable.organizationId, aiCacheTable.entityType, aiCacheTable.entityId, aiCacheTable.analysisType],
      set: { result: result as any, model, expiresAt, createdAt: new Date() },
    });
  } else {
    // No-org (system-level) entry: DELETE + INSERT to avoid NULL unique-key ambiguity
    await db.delete(aiCacheTable).where(
      and(
        eq(aiCacheTable.entityType, entityType),
        eq(aiCacheTable.entityId, entityId),
        eq(aiCacheTable.analysisType, analysisType),
        isNull(aiCacheTable.organizationId),
      )
    );
    await db.insert(aiCacheTable).values({
      organizationId: null, entityType, entityId, analysisType, result: result as any, model, expiresAt,
    });
  }
}

async function logAiAction(opts: {
  organizationId?: number | null;
  userId?: number;
  module: string;
  action: string;
  entityType?: string;
  entityId?: number;
  provider?: string;
  model?: string;
  tokensUsed?: number;
  latencyMs?: number;
  success: boolean;
  errorMessage?: string;
}) {
  await db.insert(aiLogsTable).values({
    organizationId: opts.organizationId ?? null,
    userId:         opts.userId,
    module:         opts.module as any,
    action:         opts.action,
    entityType:     opts.entityType,
    entityId:       opts.entityId,
    provider:       opts.provider,
    model:          opts.model,
    tokensUsed:     opts.tokensUsed,
    latencyMs:      opts.latencyMs,
    success:        opts.success,
    errorMessage:   opts.errorMessage,
  }).catch(() => {}); // Non-blocking — logging must never throw
}

/**
 * Execute an AI call with automatic transparent fallback.
 *
 * Resolution order:
 *   1. Configured provider (system or org-level)
 *   2. OpenRouter (free)
 *   3. Together AI (free)
 *   4. HuggingFace (free)
 *   5. Ollama (local, if available)
 *
 * Callers receive the same data regardless of which provider was used.
 * Fallback is logged at INFO level; failures at WARN level.
 */
async function callAI(
  prompt: string,
  systemPrompt: string,
  modelKey: "fast" | "smart" = "fast",
  jsonMode = true,
): Promise<AICallResult> {
  const { provider: primaryProvider, fastModel, smartModel } = await getAIProviderConfig();
  const primaryModel = modelKey === "smart" ? smartModel : fastModel;

  // Build ordered provider chain: configured primary, then free fallbacks (deduped)
  const chain: string[] = primaryProvider && primaryProvider !== "none"
    ? [primaryProvider, ...FALLBACK_CHAIN.filter(p => p !== primaryProvider)]
    : [...FALLBACK_CHAIN];

  let lastError: Error | null = null;

  for (let i = 0; i < chain.length; i++) {
    const providerKey = chain[i];
    const provDefaults = PROVIDER_DEFAULTS[providerKey as AIProvider];
    const model = i === 0
      ? primaryModel
      : ((modelKey === "smart" ? provDefaults?.smartModel : provDefaults?.fastModel) ?? primaryModel);

    try {
      const raw = await executeOnProvider(providerKey, model, systemPrompt, prompt);

      if (i > 0) {
        logger.info(
          { usedProvider: providerKey, primaryProvider: chain[0], model },
          "[AI] Fallback provider used — primary provider failed",
        );
      } else {
        logger.debug({ provider: providerKey, model, latencyMs: raw.latencyMs, tokens: raw.tokensUsed }, "AI call completed");
      }

      return {
        data:         parseAIContent(raw.content, jsonMode),
        provider:     providerKey,
        model,
        tokensUsed:   raw.tokensUsed,
        latencyMs:    raw.latencyMs,
        usedFallback: i > 0,
      };
    } catch (err: any) {
      if (i < chain.length - 1) {
        logger.warn({ provider: providerKey, error: err.message }, "[AI] Provider failed — trying next in fallback chain");
      } else {
        logger.error({ provider: providerKey, error: err.message }, "[AI] All providers in fallback chain exhausted");
      }
      lastError = err as Error;
    }
  }

  throw lastError ?? new Error("All AI providers failed");
}

// ─── Module: AI Settings ─────────────────────────────────────────────────────

export async function isModuleEnabled(module: string, organizationId?: number): Promise<boolean> {
  if (!organizationId) return true; // Default: enabled if no org
  const rows = await db.select().from(aiSettingsTable).where(
    and(
      eq(aiSettingsTable.organizationId, organizationId),
      eq(aiSettingsTable.module, module as any),
    )
  ).limit(1);
  return rows.length === 0 ? true : rows[0].enabled; // Default: enabled
}

export async function getAiSettings(organizationId?: number) {
  if (!organizationId) return {};
  const rows = await db.select().from(aiSettingsTable).where(
    eq(aiSettingsTable.organizationId, organizationId)
  );
  const result: Record<string, boolean> = {};
  for (const row of rows) {
    result[row.module] = row.enabled;
  }
  return result;
}

export async function updateAiSettings(organizationId: number, settings: Record<string, boolean>) {
  for (const [module, enabled] of Object.entries(settings)) {
    await db.insert(aiSettingsTable).values({
      organizationId,
      module: module as any,
      enabled,
    }).onConflictDoUpdate({
      target: [aiSettingsTable.organizationId, aiSettingsTable.module],
      set: { enabled, updatedAt: new Date() },
    });
  }
}

// ─── Module: Documents ───────────────────────────────────────────────────────

export interface DocumentAnalysis {
  summary: string;
  classification: string;
  suggestedTags: string[];
  suggestedDiscipline?: string;
  urgencyLevel: "low" | "medium" | "high" | "critical";
  urgencyReason: string;
  recommendations: string[];
  confidence: number;
}

export async function analyzeDocument(doc: {
  id: number;
  title: string;
  documentNumber: string;
  documentType: string;
  discipline?: string | null;
  revision?: string | null;
  status: string;
  description?: string | null;
  fileName?: string | null;
  metadata?: unknown;
}, userId?: number, forceRefresh = false, organizationId?: number | null): Promise<DocumentAnalysis> {
  if (!forceRefresh) {
    const cached = await getCache("document", doc.id, "analyze", organizationId);
    if (cached) return cached as DocumentAnalysis;
  }

  const start = Date.now();
  try {
    const { data: result, provider, model, tokensUsed } = await callAI(
      `Analyze this engineering document:
Title: ${doc.title}
Document Number: ${doc.documentNumber}
Type: ${doc.documentType}
Discipline: ${doc.discipline ?? "Unknown"}
Revision: ${doc.revision ?? "A"}
Status: ${doc.status}
Description: ${doc.description ?? "No description provided"}
File: ${doc.fileName ?? "No file"}

Respond with JSON only.`,
      `You are an expert engineering document management AI assistant. Analyze engineering documents and provide insights.
Respond ONLY with valid JSON in this exact schema:
{
  "summary": "2-3 sentence professional summary of the document",
  "classification": "one of: drawing, specification, report, memo, procedure, datasheet, certificate, correspondence, other",
  "suggestedTags": ["tag1", "tag2", "tag3"],
  "suggestedDiscipline": "one of: civil, structural, mechanical, electrical, piping, instrumentation, HVAC, fire-protection, other",
  "urgencyLevel": "one of: low, medium, high, critical",
  "urgencyReason": "brief reason for urgency level",
  "recommendations": ["action1", "action2"],
  "confidence": 0.0-1.0
}`,
    );

    await setCache("document", doc.id, "analyze", result, "fast", organizationId);
    await logAiAction({
      organizationId, userId, module: "documents", action: "analyze",
      entityType: "document", entityId: doc.id,
      provider, model, tokensUsed,
      latencyMs: Date.now() - start, success: true,
    });

    return result as DocumentAnalysis;
  } catch (err) {
    await logAiAction({
      organizationId, userId, module: "documents", action: "analyze",
      entityType: "document", entityId: doc.id,
      latencyMs: Date.now() - start, success: false,
      errorMessage: String(err),
    });
    throw err;
  }
}

// ─── Module: Correspondence ──────────────────────────────────────────────────

export interface CorrespondenceAnalysis {
  category: string;
  urgencyLevel: "low" | "medium" | "high" | "critical";
  urgencyReason: string;
  keyPoints: string[];
  suggestedReply: string;
  actionRequired: boolean;
  actionDescription?: string;
  estimatedResponseDays: number;
  sentiment: "positive" | "neutral" | "negative" | "urgent";
  relatedTopics: string[];
}

export async function analyzeCorrespondence(corr: {
  id: number;
  subject: string;
  type: string;
  body?: string | null;
  status: string;
  fromUserId?: number | null;
}, userId?: number, forceRefresh = false, organizationId?: number | null): Promise<CorrespondenceAnalysis> {
  if (!forceRefresh) {
    const cached = await getCache("correspondence", corr.id, "analyze", organizationId);
    if (cached) return cached as CorrespondenceAnalysis;
  }

  const start = Date.now();
  try {
    const { data: result, provider, model, tokensUsed } = await callAI(
      `Analyze this engineering project correspondence:
Subject: ${corr.subject}
Type: ${corr.type}
Status: ${corr.status}
Body: ${corr.body ? corr.body.substring(0, 2000) : "No body content"}

Respond with JSON only.`,
      `You are an expert engineering project communication AI assistant. Analyze correspondence and provide actionable insights.
Respond ONLY with valid JSON in this exact schema:
{
  "category": "one of: RFI, transmittal, letter, memo, notice, approval, rejection, query, instruction, other",
  "urgencyLevel": "one of: low, medium, high, critical",
  "urgencyReason": "brief reason",
  "keyPoints": ["point1", "point2", "point3"],
  "suggestedReply": "professional reply draft (2-4 sentences)",
  "actionRequired": true/false,
  "actionDescription": "what action is needed if actionRequired is true",
  "estimatedResponseDays": 1-30,
  "sentiment": "one of: positive, neutral, negative, urgent",
  "relatedTopics": ["topic1", "topic2"]
}`,
    );

    await setCache("correspondence", corr.id, "analyze", result, "fast", organizationId);
    await logAiAction({
      organizationId, userId, module: "correspondence", action: "analyze",
      entityType: "correspondence", entityId: corr.id,
      provider, model, tokensUsed,
      latencyMs: Date.now() - start, success: true,
    });

    return result as CorrespondenceAnalysis;
  } catch (err) {
    await logAiAction({
      organizationId, userId, module: "correspondence", action: "analyze",
      entityType: "correspondence", entityId: corr.id,
      latencyMs: Date.now() - start, success: false,
      errorMessage: String(err),
    });
    throw err;
  }
}

// ─── Module: Tasks ───────────────────────────────────────────────────────────

export interface TaskPriorityInsight {
  taskId: number;
  aiPriority: "low" | "medium" | "high" | "urgent";
  aiScore: number; // 0-100
  reasoning: string;
  isBottleneck: boolean;
  suggestedAssignee?: string;
  suggestedDueDate?: string;
}

export interface TaskListInsights {
  tasks: TaskPriorityInsight[];
  overallRisk: "low" | "medium" | "high" | "critical";
  bottlenecks: string[];
  topRecommendations: string[];
}

export async function prioritizeTasks(tasks: Array<{
  id: number;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  dueDate?: Date | null;
  sourceType?: string | null;
}>, userId?: number): Promise<TaskListInsights> {
  if (tasks.length === 0) {
    return { tasks: [], overallRisk: "low", bottlenecks: [], topRecommendations: [] };
  }

  const start = Date.now();
  const tasksJson = tasks.map(t => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate ? t.dueDate.toISOString().split("T")[0] : null,
    source: t.sourceType ?? "manual",
  }));

  try {
    const { data: result, provider, model, tokensUsed } = await callAI(
      `Analyze and prioritize these engineering project tasks. Today's date: ${new Date().toISOString().split("T")[0]}

Tasks: ${JSON.stringify(tasksJson, null, 2)}

Respond with JSON only.`,
      `You are an expert project manager AI. Analyze task lists and identify priorities, bottlenecks, and risks.
Respond ONLY with valid JSON in this exact schema:
{
  "tasks": [
    {
      "taskId": <number>,
      "aiPriority": "low|medium|high|urgent",
      "aiScore": <0-100>,
      "reasoning": "brief reason",
      "isBottleneck": true/false
    }
  ],
  "overallRisk": "low|medium|high|critical",
  "bottlenecks": ["bottleneck1", "bottleneck2"],
  "topRecommendations": ["action1", "action2", "action3"]
}`,
      "smart",
    );

    await logAiAction({
      userId, module: "tasks", action: "prioritize",
      provider, model, tokensUsed,
      latencyMs: Date.now() - start, success: true,
    });

    return result as TaskListInsights;
  } catch (err) {
    await logAiAction({
      userId, module: "tasks", action: "prioritize",
      latencyMs: Date.now() - start, success: false,
      errorMessage: String(err),
    });
    throw err;
  }
}

// ─── Module: Search ──────────────────────────────────────────────────────────

export interface NaturalLanguageSearchResult {
  query: string;
  interpretation: string;
  type: "document" | "correspondence" | "task" | "all";
  discipline?: string;
  status?: string;
  documentType?: string;
  keywords: string[];
  suggestions: string[];
}

export async function parseNaturalLanguageSearch(query: string): Promise<NaturalLanguageSearchResult> {
  const { data: result } = await callAI(
    `Parse this natural language search query from an engineering document management system:
"${query}"

Respond with JSON only.`,
    `You are an AI search assistant for an engineering document management system (EDMS).
Extract structured search parameters from natural language queries.
Respond ONLY with valid JSON in this exact schema:
{
  "query": "<cleaned search keywords>",
  "interpretation": "<what the user is looking for in plain English>",
  "type": "document|correspondence|task|all",
  "discipline": "<engineering discipline if mentioned, else null>",
  "status": "<status filter if mentioned, else null>",
  "documentType": "<document type if mentioned, else null>",
  "keywords": ["keyword1", "keyword2"],
  "suggestions": ["related search 1", "related search 2"]
}`,
  );

  return { ...(result as NaturalLanguageSearchResult), query };
}

// ─── Module: AI Document Management & Coding ─────────────────────────────────

export interface DocumentProcedureSuggestion {
  suggestedDocumentNumber: string;
  numberingReason: string;
  suggestedClassification: string;
  suggestedDiscipline: string;
  suggestedTitle?: string;
  suggestedRevision: string;
  requiredMetadata?: Array<{ field: string; description: string; required: boolean }>;
  namingConvention: string;
  procedureNotes: string;
  confidence: number;
}

export async function suggestDocumentProcedure(input: {
  projectCode?: string;
  projectName?: string;
  discipline?: string;
  documentType?: string;
  partialTitle?: string;
  existingNumbers?: string[];
  organizationName?: string;
}, userId?: number): Promise<DocumentProcedureSuggestion> {
  const start = Date.now();
  try {
    const { data: rawData, provider, model, tokensUsed } = await callAI(
      `Generate a document numbering suggestion. Return JSON with these fields:
- suggestedDocumentNumber: the document number (e.g. "${input.projectCode ?? "PRJ"}-ELE-DWG-001")
- numberingReason: brief explanation
- suggestedClassification: document classification
- suggestedDiscipline: engineering discipline  
- suggestedTitle: full document title
- suggestedRevision: revision code (e.g. "00" or "A")
- namingConvention: naming pattern used
- procedureNotes: key procedure notes
- confidence: number between 0 and 1

Context:
Project Code: ${input.projectCode ?? "PRJ"}
Project Name: ${input.projectName ?? "Unknown Project"}
Discipline: ${input.discipline ?? "General"}
Document Type: ${input.documentType ?? "Drawing"}
Partial Title: ${input.partialTitle ?? ""}
Existing Numbers: ${input.existingNumbers?.join(", ") || "None"}`,
      `You are an engineering document management expert. Respond with valid JSON only.`,
      "fast",
      false,
    );

    const result = rawData as string;

    // Parse JSON from the text response
    let parsed: DocumentProcedureSuggestion;
    try {
      const jsonMatch = result.match(/```json\s*([\s\S]*?)```/) ||
                        result.match(/```\s*([\s\S]*?)```/) ||
                        result.match(/(\{[\s\S]*\})/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : result.trim();
      parsed = JSON.parse(jsonStr);
    } catch {
      logger.warn({ result: String(result).substring(0, 200) }, "Failed to parse procedure suggestion");
      parsed = {
        suggestedDocumentNumber: `${input.projectCode ?? "PRJ"}-${(input.discipline ?? "GEN").substring(0, 3).toUpperCase()}-001`,
        numberingReason: "Standard engineering document numbering",
        suggestedClassification: input.documentType ?? "Drawing",
        suggestedDiscipline: input.discipline ?? "General",
        suggestedTitle: input.partialTitle ?? "Engineering Document",
        suggestedRevision: "00",
        namingConvention: "[ProjectCode]-[Discipline]-[Sequence]",
        procedureNotes: "Follow project document control procedures",
        confidence: 0.5,
      };
    }

    await logAiAction({
      userId, module: "documents", action: "suggest_procedure",
      provider, model, tokensUsed,
      latencyMs: Date.now() - start, success: true,
    });

    return parsed;
  } catch (err) {
    await logAiAction({
      userId, module: "documents", action: "suggest_procedure",
      latencyMs: Date.now() - start, success: false,
      errorMessage: String(err),
    });
    throw err;
  }
}

// ─── Module: Notifications / Urgency ─────────────────────────────────────────

export async function scoreNotificationUrgency(notifications: Array<{
  id: number | string;
  type: string;
  message: string;
  createdAt?: Date;
}>): Promise<Array<{ id: number | string; urgency: number; reason: string }>> {
  if (notifications.length === 0) return [];

  const { data: result } = await callAI(
    `Score the urgency of these engineering project notifications (0=not urgent, 100=critical):
${JSON.stringify(notifications.map(n => ({ id: n.id, type: n.type, message: n.message })))},

Respond with JSON only.`,
    `You are an engineering project AI assistant. Score notification urgency.
Respond ONLY with JSON: {"scores": [{"id": <id>, "urgency": <0-100>, "reason": "<brief>"}]}`,
  );

  return (result as any).scores ?? [];
}

// ─── Classification (used by rules engine pipeline) ───────────────────────────

export interface ClassificationResult {
  category: string;
  tags: string[];
  priority: "low" | "medium" | "high" | "critical";
}

/**
 * AI-powered classification for documents and correspondence.
 * Returns a best-effort classification even when AI is unavailable (returns nulls).
 * The caller should always wrap in try/catch.
 *
 * AI runs BEFORE the rules engine so rules can leverage AI-assigned tags/priority.
 */
export async function classifyItem(input: {
  type: "document" | "correspondence";
  organizationId?: number | null;
  title?: string | null;
  documentType?: string | null;
  discipline?: string | null;
  subject?: string | null;
  body?: string | null;
}): Promise<ClassificationResult | null> {
  // Gate 1: Global kill-switch — if classification is explicitly disabled system-wide, stop.
  const classificationEnabled = await getSystemSettingValue("ai_classification_enabled");
  if (classificationEnabled === "false") return null;

  // Gate 2: Per-organization module toggle.
  if (input.organizationId) {
    const module = input.type === "document" ? "documents" : "correspondence";
    const orgEnabled = await isModuleEnabled(module, input.organizationId);
    if (!orgEnabled) return null;
  }

  // Gate 2.5: Per-org daily quota check.
  // Count today's successful AI log entries for this org; block if limit is hit.
  if (input.organizationId) {
    const quota = await getOrgAiQuota(input.organizationId);
    if (quota.dailyLimit > 0 && quota.usedToday >= quota.dailyLimit) {
      logger.warn(
        { organizationId: input.organizationId, usedToday: quota.usedToday, dailyLimit: quota.dailyLimit },
        "classifyItem skipped — org AI daily quota reached",
      );
      return null;
    }

    // Gate 2.6: Monthly token limit check.
    if (quota.monthlyTokenLimit > 0 && quota.usedTokensThisMonth >= quota.monthlyTokenLimit) {
      logger.warn(
        { organizationId: input.organizationId, usedTokensThisMonth: quota.usedTokensThisMonth, monthlyTokenLimit: quota.monthlyTokenLimit },
        "classifyItem skipped — org AI monthly token quota reached",
      );
      return null;
    }

    // Gate 2.7: Org-level AI provider override.
    // If the org has an explicit provider configured, use it (or skip if "none").
    if (quota.provider !== null) {
      if (quota.provider === "none") return null;

      // Build a one-shot client for the org's provider
      const orgClient = await buildProviderClient(quota.provider);
      if (!orgClient) return null; // provider not configured — fail gracefully

      // Resolve the model: org override → provider default
      const providerDefaults: Record<string, string> = {
        openai: "gpt-4o-mini",
        groq:   "llama-3.1-8b-instant",
        ollama: "llama3.2",
      };
      const model = quota.model ?? providerDefaults[quota.provider] ?? "gpt-4o-mini";

      const context = input.type === "document"
        ? `Document: "${input.title ?? ""}" | Type: ${input.documentType ?? "unknown"} | Discipline: ${input.discipline ?? "unknown"}`
        : `Correspondence subject: "${input.subject ?? ""}" | Body preview: ${(input.body ?? "").slice(0, 200)}`;

      try {
        const response = await orgClient.chat.completions.create({
          model,
          max_completion_tokens: 512,
          messages: [
            { role: "system", content: "You are an engineering document classification AI. Classify documents concisely." },
            {
              role: "user",
              content: `Classify this engineering document/correspondence for an EDMS system.\n${context}\n\nRespond with JSON only: {"category": "<one of: Drawing|Report|Procedure|Specification|Letter|Memo|RFI|NCR|Other>", "tags": ["<tag1>","<tag2>"], "priority": "<low|medium|high|critical>"}`,
            },
          ],
          ...(quota.provider !== "groq" ? { response_format: { type: "json_object" } } : {}),
        });
        const content = response.choices[0]?.message?.content ?? "{}";
        const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) || content.match(/```\s*([\s\S]*?)```/);
        const jsonStr  = jsonMatch ? jsonMatch[1].trim() : content.trim();
        return JSON.parse(jsonStr) as ClassificationResult;
      } catch (err) {
        logger.warn({ err, provider: quota.provider }, "Org-level classifyItem call failed");
        return null;
      }
    }
  }

  // Gate 3: Global provider must not be "none".
  const { provider } = await getAIProviderConfig();
  if (provider === "none") return null;

  const context = input.type === "document"
    ? `Document: "${input.title ?? ""}" | Type: ${input.documentType ?? "unknown"} | Discipline: ${input.discipline ?? "unknown"}`
    : `Correspondence subject: "${input.subject ?? ""}" | Body preview: ${(input.body ?? "").slice(0, 200)}`;

  const { data: result } = await callAI(
    `Classify this engineering document/correspondence for an EDMS system.
${context}

Respond with JSON only: {"category": "<one of: Drawing|Report|Procedure|Specification|Letter|Memo|RFI|NCR|Other>", "tags": ["<tag1>","<tag2>"], "priority": "<low|medium|high|critical>"}`,
    "You are an engineering document classification AI. Classify documents concisely.",
    "fast",
    true,
  );

  return (result as ClassificationResult | null) ?? null;
}

// ── Migration wizard helpers ──────────────────────────────────────────────────

/** Returns the current provider name for a given org, or null if none configured. */
export async function getOrgProvider(organizationId: number): Promise<string | null> {
  try {
    const quota = await getOrgAiQuota(organizationId);
    return quota.provider && quota.provider !== "none" ? quota.provider : null;
  } catch {
    const { provider } = await getAIProviderConfig();
    return provider !== "none" ? provider : null;
  }
}

export interface ExtractedDocMeta {
  metadata: {
    title?: string;
    code?: string;
    discipline?: string;
    docType?: string;
    revision?: string;
    date?: string;
    issuer?: string;
    isReply?: boolean;
    replyTo?: string;
  };
  confidence: number;
}

/**
 * Use AI to extract document metadata from its file path and name.
 * Falls back gracefully on any error.
 */
export async function extractDocumentMetadataFromPath(
  filePath: string,
  fileName: string,
): Promise<ExtractedDocMeta> {
  const prompt = `You are an engineering document management AI. Given a file path from an engineering project, extract document metadata.

File path: "${filePath}"
File name: "${fileName}"

Extract the following metadata (leave empty string if not determinable):
- title: Human-readable document title
- code: Document number/code (e.g., ABC-CIV-DWG-001)
- discipline: Engineering discipline (Civil, Structural, Mechanical, Electrical, Instrumentation, Piping, Process, Architecture, HVAC, General)
- docType: Document type (Drawing, Specification, Report, Calculation, Procedure, Manual, Letter, Transmittal, ITR, NCR, WIR, RFI, Other)
- revision: Revision identifier (e.g., A, B, 1, 2, P1)
- date: Date in YYYY-MM-DD format if discernible
- issuer: Issuing company or person if in path
- isReply: true if the document appears to be a reply (look for Re:, response, reply in name)
- replyTo: Referenced document number if this is a reply
- confidence: Integer 0-100 representing extraction confidence

Return JSON only.`;

  try {
    const { data: rawResult } = await callAI(
      prompt,
      "You extract structured metadata from engineering document paths. Return valid JSON only.",
      "fast",
      true,
    );

    const result = rawResult as ExtractedDocMeta["metadata"] & { confidence?: number };
    const confidence = typeof result?.confidence === "number" ? result.confidence : 50;
    const { confidence: _, ...metadata } = result as any;
    return { metadata, confidence };
  } catch {
    return { metadata: {}, confidence: 0 };
  }
}
