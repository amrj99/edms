/**
 * AI Core — provider management, client creation, callAI, cache, logs, quota.
 * All domain AI modules (ai-documents, ai-correspondence, ai-tasks, ai-search)
 * import their infrastructure from here. Nothing outside this directory should
 * import directly from ai-core; use ai-service.ts (the barrel) instead.
 */
import OpenAI from "openai";
import { db } from "@workspace/db";
import {
  aiCacheTable, aiLogsTable, aiAnalysisTable,
  systemSettingsTable, orgConfigTable,
} from "@workspace/db";
import { and, desc, eq, gt, gte, isNull, sql } from "drizzle-orm";
import { logger } from "./logger.js";

// ─── Constants ────────────────────────────────────────────────────────────────

export const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ─── Provider types ───────────────────────────────────────────────────────────

export type AIProvider =
  | "cloudflare"    // free primary: Cloudflare Workers AI (OpenAI-compatible)
  | "groq"          // free: Groq Cloud (fast inference)
  | "openrouter"    // free: OpenRouter free models
  | "huggingface"   // free: HuggingFace Inference API
  | "together"      // free: Together AI free tier
  | "ollama"        // self-hosted local Ollama
  | "openai"        // paid optional: OpenAI direct
  | "anthropic"     // paid optional: Anthropic Claude
  | "openai_replit" // legacy: Replit OpenAI proxy (keep until CF+Groq confirmed)
  | "none";

export interface AIProviderConfig {
  provider: AIProvider;
  fastModel: string;
  smartModel: string;
}

export const PROVIDER_DEFAULTS: Record<AIProvider, { fastModel: string; smartModel: string }> = {
  cloudflare:    { fastModel: "@cf/meta/llama-3.2-3b-instruct",        smartModel: "@cf/mistral/mistral-7b-instruct-v0.1" },
  groq:          { fastModel: "llama-3.3-70b-versatile",               smartModel: "llama-3.3-70b-versatile" },
  openrouter:    { fastModel: "meta-llama/llama-3.2-3b-instruct:free", smartModel: "mistralai/mistral-7b-instruct:free" },
  huggingface:   { fastModel: "mistralai/Mistral-7B-Instruct-v0.3",    smartModel: "meta-llama/Meta-Llama-3-8B-Instruct" },
  together:      { fastModel: "meta-llama/Llama-3.2-3B-Instruct-Turbo", smartModel: "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo" },
  openai_replit: { fastModel: "gpt-4o-mini",                           smartModel: "gpt-4o" },
  ollama:        { fastModel: "llama3.2",                              smartModel: "llama3.1" },
  openai:        { fastModel: "gpt-4o-mini",                           smartModel: "gpt-4o" },
  anthropic:     { fastModel: "claude-3-haiku-20240307",               smartModel: "claude-3-5-sonnet-20241022" },
  none:          { fastModel: "",                                       smartModel: "" },
};

// ─── System settings helper ───────────────────────────────────────────────────

export async function getSystemSettingValue(key: string): Promise<string | null> {
  const rows = await db.select().from(systemSettingsTable).where(eq(systemSettingsTable.key, key));
  return rows[0]?.value ?? null;
}

// ─── Provider config ──────────────────────────────────────────────────────────

export async function getAIProviderConfig(): Promise<AIProviderConfig> {
  const provider = (await getSystemSettingValue("ai_provider") ?? "cloudflare") as AIProvider;
  const defaults = PROVIDER_DEFAULTS[provider] ?? PROVIDER_DEFAULTS.openrouter;
  const fastModel  = await getSystemSettingValue("ai_fast_model")  ?? defaults.fastModel;
  const smartModel = await getSystemSettingValue("ai_smart_model") ?? defaults.smartModel;
  return { provider, fastModel, smartModel };
}

// ─── Dynamic AI client (cached singleton per provider) ────────────────────────

let _cachedClient: OpenAI | null = null;
let _cachedProvider: string | null = null;

export async function getAIClient(): Promise<OpenAI> {
  const { provider } = await getAIProviderConfig();
  if (_cachedClient && _cachedProvider === provider) return _cachedClient;

  _cachedClient = null;
  _cachedProvider = provider;

  if (provider === "none") {
    throw new Error("AI provider is set to 'none'. Enable an AI provider in Admin → AI Settings.");
  } else if (provider === "cloudflare") {
    const accountId = process.env.CF_ACCOUNT_ID;
    const apiKey    = process.env.CF_AI_TOKEN;
    if (!accountId || !apiKey) throw new Error("CF_ACCOUNT_ID and CF_AI_TOKEN are required for Cloudflare Workers AI.");
    _cachedClient = new OpenAI({
      apiKey,
      baseURL: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`,
    });
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
    if (!apiKey) throw new Error("GROQ_API_KEY is not set.");
    _cachedClient = new OpenAI({ apiKey, baseURL: "https://api.groq.com/openai/v1" });
  } else if (provider === "ollama") {
    const baseURL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1";
    _cachedClient = new OpenAI({ apiKey: "ollama", baseURL });
  } else if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");
    _cachedClient = new OpenAI({ apiKey });
  } else {
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
    _cachedClient = null;
    _cachedProvider = null;
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
    cloudflare: {
      configured: !!(process.env.CF_ACCOUNT_ID && process.env.CF_AI_TOKEN),
      isFree: true,
      label: "Cloudflare Workers AI (Free — Recommended)",
      description: "Run Llama 3, Mistral, and Gemma models via Cloudflare's global network. Uses your existing Cloudflare account.",
      envVarsRequired: ["CF_ACCOUNT_ID", "CF_AI_TOKEN"],
      docsUrl: "https://developers.cloudflare.com/workers-ai/",
    },
    groq: {
      configured: !!process.env.GROQ_API_KEY,
      isFree: true,
      label: "Groq Cloud (Free Tier — Fast)",
      description: "Ultra-fast inference for Llama 3.3 70B. Free tier available at console.groq.com.",
      envVarsRequired: ["GROQ_API_KEY"],
      docsUrl: "https://console.groq.com",
    },
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
    openai_replit: {
      configured: !!(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL && process.env.AI_INTEGRATIONS_OPENAI_API_KEY),
      isFree: true,
      label: "OpenAI via Replit Proxy (Development Only)",
      description: "Replit-managed OpenAI proxy. Only works inside the Replit environment, not on VPS.",
      envVarsRequired: ["AI_INTEGRATIONS_OPENAI_BASE_URL", "AI_INTEGRATIONS_OPENAI_API_KEY"],
      docsUrl: null,
    },
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

// ─── Subscription tiers ───────────────────────────────────────────────────────

export const SUBSCRIPTION_TIERS = {
  free:         { aiProvider: "none",        aiModel: null,                                        aiDailyLimit: 0 },
  starter:      { aiProvider: "cloudflare",  aiModel: "@cf/meta/llama-3.2-3b-instruct",           aiDailyLimit: 10 },
  basic:        { aiProvider: "cloudflare",  aiModel: "@cf/meta/llama-3.2-3b-instruct",           aiDailyLimit: 30 },
  professional: { aiProvider: "cloudflare",  aiModel: "@cf/mistral/mistral-7b-instruct-v0.1",     aiDailyLimit: 500 },
  enterprise:   { aiProvider: "cloudflare",  aiModel: null,                                        aiDailyLimit: 0 },
} as const;

export type SubscriptionTier = keyof typeof SUBSCRIPTION_TIERS;

// ─── Per-org AI quota ─────────────────────────────────────────────────────────

export interface OrgAiQuota {
  provider: string | null;
  model: string | null;
  dailyLimit: number;
  usedToday: number;
  remaining: number | null;
  monthlyTokenLimit: number;
  usedTokensThisMonth: number;
  remainingTokens: number | null;
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

  const usedToday           = Number(countRow?.count ?? 0);
  const usedTokensThisMonth = Number(tokenRow?.total ?? 0);
  const remaining           = dailyLimit > 0 ? Math.max(0, dailyLimit - usedToday) : null;
  const remainingTokens     = monthlyTokenLimit > 0 ? Math.max(0, monthlyTokenLimit - usedTokensThisMonth) : null;

  return { provider, model, dailyLimit, usedToday, remaining, monthlyTokenLimit, usedTokensThisMonth, remainingTokens };
}

// ─── One-shot client builder (for per-org or fallback use) ────────────────────

export async function buildProviderClient(provider: string): Promise<OpenAI | null> {
  if (provider === "cloudflare") {
    const accountId = process.env.CF_ACCOUNT_ID;
    const apiKey    = process.env.CF_AI_TOKEN;
    if (!accountId || !apiKey) { logger.warn("Org uses cloudflare but CF_ACCOUNT_ID or CF_AI_TOKEN is not set"); return null; }
    return new OpenAI({ apiKey, baseURL: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1` });
  }
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
    const apiKey = process.env.OPENAI_API_KEY ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
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

// ─── Fallback chain ───────────────────────────────────────────────────────────

const FALLBACK_CHAIN: string[] = ["cloudflare", "groq", "openrouter", "together", "huggingface", "ollama"];

// ─── Core result type ─────────────────────────────────────────────────────────

export interface AICallResult {
  data: unknown;
  provider: string;
  model: string;
  tokensUsed?: number;
  latencyMs: number;
  usedFallback: boolean;
}

// ─── Single-provider executor ─────────────────────────────────────────────────

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

// ─── JSON parser ──────────────────────────────────────────────────────────────

export function parseAIContent(content: string, jsonMode: boolean): unknown {
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

// ─── Short-term cache (dedup layer) ──────────────────────────────────────────

export async function getCache(
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
      organizationId != null ? eq(aiCacheTable.organizationId, organizationId) : undefined,
    )
  ).limit(1);
  return rows[0]?.result ?? null;
}

export async function setCache(
  entityType: string,
  entityId: number,
  analysisType: string,
  result: unknown,
  model: string,
  organizationId?: number | null,
) {
  const expiresAt = new Date(Date.now() + CACHE_TTL_MS);

  if (organizationId != null) {
    await db.insert(aiCacheTable).values({
      organizationId, entityType, entityId, analysisType, result: result as any, model, expiresAt,
    }).onConflictDoUpdate({
      target: [aiCacheTable.organizationId, aiCacheTable.entityType, aiCacheTable.entityId, aiCacheTable.analysisType],
      set: { result: result as any, model, expiresAt, createdAt: new Date() },
    });
  } else {
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

// ─── Audit log (non-blocking) ─────────────────────────────────────────────────

export async function logAiAction(opts: {
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

// ─── Core AI call with transparent fallback ───────────────────────────────────

/**
 * Execute an AI call with automatic transparent fallback.
 *
 * Resolution order:
 *   1. Org-level ai_provider override (from org_config) — if organizationId is provided
 *   2. System-level configured provider (from system_settings, defaults to "cloudflare")
 *   3. Cloudflare → Groq → OpenRouter → Together → HuggingFace → Ollama
 */
export async function callAI(
  prompt: string,
  systemPrompt: string,
  modelKey: "fast" | "smart" = "fast",
  jsonMode = true,
  organizationId?: number | null,
): Promise<AICallResult> {
  // Resolve effective primary provider: org override → system default
  let primaryProvider: string;
  let primaryModel: string;

  if (organizationId) {
    const [orgCfg] = await db
      .select({ aiProvider: orgConfigTable.aiProvider, aiModel: orgConfigTable.aiModel })
      .from(orgConfigTable)
      .where(eq(orgConfigTable.organizationId, organizationId));
    const orgProvider = orgCfg?.aiProvider;
    if (orgProvider && orgProvider !== "none") {
      primaryProvider = orgProvider;
      const orgModel = orgCfg?.aiModel;
      const defaults = PROVIDER_DEFAULTS[orgProvider as AIProvider];
      primaryModel = orgModel ?? (modelKey === "smart" ? defaults?.smartModel : defaults?.fastModel) ?? "";
    } else {
      const sysConfig = await getAIProviderConfig();
      primaryProvider = sysConfig.provider;
      primaryModel = modelKey === "smart" ? sysConfig.smartModel : sysConfig.fastModel;
    }
  } else {
    const sysConfig = await getAIProviderConfig();
    primaryProvider = sysConfig.provider;
    primaryModel = modelKey === "smart" ? sysConfig.smartModel : sysConfig.fastModel;
  }

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
        logger.info({ usedProvider: providerKey, primaryProvider: chain[0], model }, "[AI] Fallback provider used");
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

// ─── Permanent analysis store (Phase 2) ──────────────────────────────────────

/**
 * Look up the most recent permanent analysis for an entity+revision.
 * Returns null if no analysis has ever been stored.
 */
export async function lookupAnalysis(
  entityType: string,
  entityId: number,
  analysisType: string,
  entityRevision?: string | null,
  organizationId?: number | null,
): Promise<unknown | null> {
  const conditions = [
    eq(aiAnalysisTable.entityType, entityType),
    eq(aiAnalysisTable.entityId, entityId),
    eq(aiAnalysisTable.analysisType, analysisType),
    eq(aiAnalysisTable.isLatest, true),
  ];
  if (entityRevision != null) conditions.push(eq(aiAnalysisTable.entityRevision, entityRevision));
  if (organizationId != null) conditions.push(eq(aiAnalysisTable.organizationId, organizationId));

  const rows = await db.select().from(aiAnalysisTable)
    .where(and(...conditions))
    .orderBy(desc(aiAnalysisTable.createdAt))
    .limit(1);

  return rows[0]?.result ?? null;
}

/**
 * Persist a new analysis result permanently.
 * Marks any previous isLatest=true row for the same entity+revision as isLatest=false.
 */
export async function saveAnalysis(opts: {
  entityType: string;
  entityId: number;
  analysisType: string;
  entityRevision?: string | null;
  organizationId?: number | null;
  result: unknown;
  provider: string;
  model: string;
  tokensUsed?: number;
  latencyMs?: number;
  triggeredBy?: number;
}): Promise<void> {
  const {
    entityType, entityId, analysisType, entityRevision,
    organizationId, result, provider, model, tokensUsed, latencyMs, triggeredBy,
  } = opts;

  await db.transaction(async (tx) => {
    // Mark previous latest rows as no longer latest
    const prevConditions = [
      eq(aiAnalysisTable.entityType, entityType),
      eq(aiAnalysisTable.entityId, entityId),
      eq(aiAnalysisTable.analysisType, analysisType),
      eq(aiAnalysisTable.isLatest, true),
    ];
    if (entityRevision != null) prevConditions.push(eq(aiAnalysisTable.entityRevision, entityRevision));
    if (organizationId != null) prevConditions.push(eq(aiAnalysisTable.organizationId, organizationId));

    await tx.update(aiAnalysisTable)
      .set({ isLatest: false })
      .where(and(...prevConditions));

    await tx.insert(aiAnalysisTable).values({
      organizationId: organizationId ?? null,
      entityType,
      entityId,
      entityRevision: entityRevision ?? null,
      analysisType,
      result: result as any,
      provider,
      model,
      tokensUsed: tokensUsed ?? null,
      latencyMs: latencyMs ?? null,
      triggeredBy: triggeredBy ?? null,
      isLatest: true,
    });
  });
}
