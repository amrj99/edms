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
  systemSettingsTable, orgConfigTable, organizationsTable,
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
  | "none";

export interface AIProviderConfig {
  provider: AIProvider;
  fastModel: string;
  smartModel: string;
  providerSource: "env" | "db" | "fallback";
  modelSource: "env" | "db" | "fallback";
}

export const PROVIDER_DEFAULTS: Record<AIProvider, { fastModel: string; smartModel: string }> = {
  cloudflare:    { fastModel: "@cf/meta/llama-3.1-8b-instruct",        smartModel: "@cf/mistral/mistral-7b-instruct-v0.1" },
  groq:          { fastModel: "llama-3.3-70b-versatile",               smartModel: "llama-3.3-70b-versatile" },
  openrouter:    { fastModel: "meta-llama/llama-3.2-3b-instruct:free", smartModel: "mistralai/mistral-7b-instruct:free" },
  huggingface:   { fastModel: "mistralai/Mistral-7B-Instruct-v0.3",    smartModel: "meta-llama/Meta-Llama-3-8B-Instruct" },
  together:      { fastModel: "meta-llama/Llama-3.2-3B-Instruct-Turbo", smartModel: "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo" },
  ollama:        { fastModel: "llama3.2",                              smartModel: "llama3.1" },
  openai:        { fastModel: "anthropic/claude-3.5-sonnet",           smartModel: "anthropic/claude-3.5-sonnet" },
  anthropic:     { fastModel: "claude-3-haiku-20240307",               smartModel: "claude-3-5-sonnet-20241022" },
  none:          { fastModel: "",                                       smartModel: "" },
};

/**
 * Default model for all premium AI calls.
 * Resolved at runtime: AI_MODEL env var → "anthropic/claude-3.5-sonnet".
 * This applies to ANY premium provider (openai, openrouter, etc.) when no
 * explicit model is configured in system_settings.ai_premium_model.
 */
export const PREMIUM_MODEL_DEFAULT = process.env.AI_MODEL ?? "anthropic/claude-3.5-sonnet";

/**
 * Return the outbound base URL for a given provider key.
 * Used for logging — actual client construction is in getAIClient() / buildProviderClient().
 */
export function getProviderBaseURL(provider: string): string {
  switch (provider) {
    case "cloudflare":  return `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID ?? "<CF_ACCOUNT_ID>"}/ai/v1`;
    case "openrouter":  return "https://openrouter.ai/api/v1";
    case "openai":      return process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    case "groq":        return "https://api.groq.com/openai/v1";
    case "together":    return "https://api.together.xyz/v1";
    case "huggingface": return "https://api-inference.huggingface.co/models";
    case "ollama":      return process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1";
    default:            return "unknown";
  }
}

// ─── System settings helper ───────────────────────────────────────────────────

export async function getSystemSettingValue(key: string): Promise<string | null> {
  const rows = await db.select().from(systemSettingsTable).where(eq(systemSettingsTable.key, key));
  return rows[0]?.value ?? null;
}

// ─── Provider config ──────────────────────────────────────────────────────────

export async function getAIProviderConfig(): Promise<AIProviderConfig> {
  // ── Provider resolution: ENV → DB → hardcoded fallback ──────────────────────
  // AI_PROVIDER env var ALWAYS wins. This lets VPS operators configure the
  // provider without touching the database at all.
  const envProvider = (process.env.AI_PROVIDER || null) as AIProvider | null;
  const dbProvider  = envProvider ? null : ((await getSystemSettingValue("ai_provider")) as AIProvider | null);
  const provider    = (envProvider ?? dbProvider ?? "cloudflare") as AIProvider;
  const providerSource: AIProviderConfig["providerSource"] =
    envProvider ? "env" : dbProvider ? "db" : "fallback";

  const defaults = PROVIDER_DEFAULTS[provider] ?? PROVIDER_DEFAULTS.openrouter;

  // ── Model resolution: ENV → DB → compiled default ───────────────────────────
  const envModel   = process.env.AI_MODEL || null;
  const dbFast     = envModel ? null : await getSystemSettingValue("ai_fast_model");
  const dbSmart    = envModel ? null : await getSystemSettingValue("ai_smart_model");
  const fastModel  = envModel ?? dbFast  ?? defaults.fastModel;
  const smartModel = envModel ?? dbSmart ?? defaults.smartModel;
  const modelSource: AIProviderConfig["modelSource"] =
    envModel ? "env" : (dbFast || dbSmart) ? "db" : "fallback";

  return { provider, fastModel, smartModel, providerSource, modelSource };
}

/**
 * Log the resolved AI configuration at server startup.
 * Prints exactly which source (env / db / fallback) each value came from so
 * operators can verify configuration without making an AI request.
 */
export async function logAIConfigAtStartup(): Promise<void> {
  try {
    const routingMode = (await getSystemSettingValue("ai_routing_mode")) ?? "credits";
    const threshold   = (await getSystemSettingValue("ai_credits_threshold")) ?? String(50);
    const premiumProv = (await getSystemSettingValue("ai_premium_provider")) ?? "openai";
    const premiumMdl  = (await getSystemSettingValue("ai_premium_model"))    ?? "(not set — using PREMIUM_MODEL_DEFAULT)";
    const freeProv    = (await getSystemSettingValue("ai_free_provider"))    ?? "cloudflare";

    const envProvider     = process.env.AI_PROVIDER   ?? null;
    const isDebugOverride = process.env.AI_DEBUG_OVERRIDE === "true";
    // In credits mode, AI_PROVIDER only fires when AI_DEBUG_OVERRIDE=true
    const envOverrideWouldFire = envProvider && (routingMode !== "credits" || isDebugOverride);

    logger.info({
      // ── Routing ───────────────────────────────────────────────────────────
      routingMode,
      creditsThreshold:    Number(threshold),
      premiumProvider:     premiumProv,
      premiumBaseURL:      getProviderBaseURL(premiumProv),
      premiumModel:        premiumMdl,
      freeProvider:        freeProv,
      freeBaseURL:         getProviderBaseURL(freeProv),
      // ── ENV override status ───────────────────────────────────────────────
      envAI_PROVIDER:      envProvider                                  ?? "(not set)",
      envAI_MODEL:         process.env.AI_MODEL                        ?? "(not set)",
      envOverrideActive:   envOverrideWouldFire ? "YES ⚠" : "no",
      debugOverrideFlag:   isDebugOverride ? "AI_DEBUG_OVERRIDE=true ⚠" : "(not set)",
      // ── Key presence ──────────────────────────────────────────────────────
      envBaseURL:          process.env.AI_INTEGRATIONS_OPENAI_BASE_URL ?? "(not set)",
      integrationKeySet:   !!(process.env.AI_INTEGRATIONS_OPENAI_API_KEY),
      cloudflareKeySet:    !!(process.env.CF_AI_TOKEN),
      openrouterKeySet:    !!(process.env.OPENROUTER_API_KEY),
      // ── Effective model at startup ────────────────────────────────────────
      effectivePremiumModel: PREMIUM_MODEL_DEFAULT,
    }, "[AI] ═══ startup config resolved ═══");

    if (envOverrideWouldFire) {
      logger.warn(
        { envAI_PROVIDER: envProvider, routingMode, debugOverride: isDebugOverride },
        "[AI] ⚠ startup: ENV override is ACTIVE — credit routing is bypassed for every request",
      );
    }
  } catch (err) {
    logger.warn({ err }, "[AI] Could not resolve startup config (DB may not be ready yet)");
  }
}

// ─── Dynamic AI client (cached singleton per provider) ────────────────────────

let _cachedClient: OpenAI | null = null;
let _cachedProvider: string | null = null;

export async function getAIClient(providerOverride?: AIProvider | null): Promise<OpenAI> {
  const provider = providerOverride ?? (await getAIProviderConfig()).provider;
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
    const apiKey = process.env.OPENAI_API_KEY ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY (or AI_INTEGRATIONS_OPENAI_API_KEY) is not set.");
    const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    _cachedClient = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  } else {
    throw new Error(
      `Unknown AI provider: "${provider}". ` +
      "Valid providers: cloudflare, groq, openrouter, together, huggingface, ollama, openai, anthropic, none. " +
      "Update the provider in Admin → AI Settings.",
    );
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
  free:         { aiProvider: "cloudflare",  aiModel: "@cf/meta/llama-3.2-3b-instruct",        aiDailyLimit: 20 },
  starter:      { aiProvider: "cloudflare",  aiModel: "@cf/meta/llama-3.2-3b-instruct",        aiDailyLimit: 20 },
  basic:        { aiProvider: "cloudflare",  aiModel: "@cf/mistral/mistral-7b-instruct-v0.1",  aiDailyLimit: 50 },
  professional: { aiProvider: "cloudflare",  aiModel: "@cf/mistral/mistral-7b-instruct-v0.1",  aiDailyLimit: 200 },
  enterprise:   { aiProvider: "cloudflare",  aiModel: null,                                     aiDailyLimit: 0 },
  trial:        { aiProvider: "cloudflare",  aiModel: "@cf/meta/llama-3.2-3b-instruct",        aiDailyLimit: 30 },
} as const;

export type SubscriptionTier = keyof typeof SUBSCRIPTION_TIERS;

// ─── Privacy mode helper ──────────────────────────────────────────────────────

export async function getOrgPrivacyMode(organizationId?: number | null): Promise<boolean> {
  if (!organizationId) return false;
  try {
    const [cfg] = await db
      .select({ aiPrivacyMode: orgConfigTable.aiPrivacyMode })
      .from(orgConfigTable)
      .where(eq(orgConfigTable.organizationId, organizationId));
    return cfg?.aiPrivacyMode ?? false;
  } catch {
    return false;
  }
}

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
  return null;
}

// ─── Fallback chain ───────────────────────────────────────────────────────────

const FALLBACK_CHAIN: string[] = ["cloudflare", "groq", "openrouter", "together", "huggingface", "ollama"];

/**
 * Providers that are always free-tier regardless of routing mode.
 * Used to derive `AICallResult.tier` in callAI() — works for all resolution
 * modes (credits_premium, org_override, env_override, etc.).
 * Extend this set as additional free providers are integrated.
 */
const FREE_TIER_PROVIDERS = new Set(["cloudflare", "groq", "ollama", "huggingface"]);

/**
 * Resolve the best available free-tier provider for the current environment.
 *
 * Priority chain: cloudflare → groq
 * Returns the first provider whose required credentials are present in the environment.
 * Falls back to the ai_free_provider system setting (default: "cloudflare") if neither
 * entry in the chain has credentials — so callers always receive a valid provider string
 * for tier derivation and logging even when no free provider is reachable at runtime.
 *
 * Callers use the returned provider string for tier derivation (`useProvider === freeProv`)
 * and pass the returned model string directly to the AI call. Client construction is
 * handled by getAIClient() / buildProviderClient() using the resolved provider key.
 */
export async function resolveFreeProvider(): Promise<{ provider: AIProvider; model: string }> {
  const chain: Array<{ provider: AIProvider; configured: () => boolean }> = [
    {
      provider: "cloudflare",
      configured: () => !!(process.env.CF_ACCOUNT_ID && process.env.CF_AI_TOKEN),
    },
    {
      provider: "groq",
      configured: () => !!process.env.GROQ_API_KEY,
    },
  ];

  for (const entry of chain) {
    if (entry.configured()) {
      const model = PROVIDER_DEFAULTS[entry.provider]?.fastModel ?? "";
      return { provider: entry.provider, model };
    }
  }

  // Neither primary free provider has credentials — fall back to the system setting
  // so the route still has a valid freeProv for tier derivation and logging.
  const settingProv = ((await getSystemSettingValue("ai_free_provider")) ?? "cloudflare") as AIProvider;
  const model = PROVIDER_DEFAULTS[settingProv]?.fastModel ?? "@cf/meta/llama-3.1-8b-instruct";
  return { provider: settingProv, model };
}

// ─── Tier-specific fallback chains ────────────────────────────────────────────
// Controls which providers each subscription tier is allowed to fall back to.
// Adding a new tier = one line here. No changes needed in callAI() or any route.
export const TIER_FALLBACK_CHAINS: Record<string, string[]> = {
  free:         ["cloudflare"],
  starter:      ["cloudflare"],
  basic:        ["cloudflare", "openrouter"],
  professional: ["cloudflare", "openrouter", "together"],
  enterprise:   ["cloudflare", "groq", "openrouter", "together", "huggingface", "ollama", "openai", "anthropic"],
  trial:        ["cloudflare", "openrouter"],
};

// ─── Core result type ─────────────────────────────────────────────────────────

export interface AICallResult {
  data: unknown;
  provider: string;
  model: string;
  tokensUsed?: number;
  latencyMs: number;
  usedFallback: boolean;
  /** "premium" = paid provider (e.g. OpenRouter), "free" = cost-free provider (e.g. Cloudflare). */
  tier: "premium" | "free";
  /**
   * True when the org has enough credits for premium but this call used the free provider
   * (e.g. a simple /command request conserving credits). Always false for callAI() — complexity
   * gating only applies in the /command route where the caller can re-request with advanced=true.
   */
  upgradeAvailable: boolean;
}

// ─── Credit-based routing ─────────────────────────────────────────────────────

export type AIRoutingMode = "credits" | "tier" | "fixed";

/** Minimum credit balance to use the premium provider (system_settings override available). */
const CREDITS_THRESHOLD_DEFAULT = 50;
/** Provider used when credits ≥ threshold. "openai" routes through OpenRouter if AI_INTEGRATIONS env vars are set. */
const CREDITS_PREMIUM_PROVIDER_DEFAULT: AIProvider = "openai";
/** Provider used when credits < threshold (always free). */
const CREDITS_FREE_PROVIDER_DEFAULT: AIProvider = "cloudflare";

/**
 * The resolved provider decision for a single AI request.
 * Every AI call log entry should include this so operators can see exactly
 * why a provider was chosen.
 */
export interface ProviderResolution {
  provider: AIProvider;
  model: string;
  /** Why this provider was selected. Included in every AI log entry. */
  reason:
    | "env_override"      // AI_PROVIDER env var is set — debug/ops use only
    | "org_override"      // admin manually set org_config.aiProvider
    | "credits_premium"   // balance ≥ threshold → premium provider
    | "credits_free"      // balance < threshold → free provider
    | "tier_config"       // routing_mode = "tier"
    | "system_fallback";  // no other rule matched
  creditsBalance?: number;
  creditsThreshold?: number;
  /** Subscription tier — used by callAI() to pick the fallback chain. */
  tier?: string;
}

/**
 * Resolve the AI provider for one request using the configured routing mode.
 *
 * Priority order (first match wins):
 *   1. AI_PROVIDER env var       — always wins, for debugging/ops
 *   2. org_config.aiProvider     — explicit per-org admin override
 *   3. Credits mode (default)    — balance ≥ threshold → premium, < threshold → free
 *   4. System-level fallback     — env → DB → hardcoded "cloudflare"
 *
 * Configuration lives in system_settings (key/value, no schema change needed):
 *   ai_routing_mode      — "credits" (default) | "tier" | "fixed"
 *   ai_credits_threshold — integer, default 50
 *   ai_premium_provider  — default "openai" (routes to OpenRouter via AI_INTEGRATIONS env)
 *   ai_premium_model     — default: reads AI_MODEL env or provider default
 *   ai_free_provider     — default "cloudflare"
 */
export async function resolveProviderForOrg(
  orgId: number | null | undefined,
  modelKey: "fast" | "smart" = "fast",
): Promise<ProviderResolution> {
  // ── 0. Fetch routing mode first — it controls ENV override eligibility ─────
  // Done before any other check so the ENV guard below is always correct.
  const routingMode = ((await getSystemSettingValue("ai_routing_mode")) ?? "credits") as AIRoutingMode;

  // ── 1. ENV override — DEBUG / OPS ONLY, not production routing logic ───────
  // In production (ai_routing_mode = "credits"), AI_PROVIDER is intentionally
  // ignored UNLESS the operator also sets AI_DEBUG_OVERRIDE=true.  This ensures
  // that leftover or stale AI_PROVIDER env vars on the VPS cannot silently
  // bypass the credit-based routing that is the intended production behaviour.
  //
  // To use the override in production:  set both AI_PROVIDER=<x> AND AI_DEBUG_OVERRIDE=true.
  // To disable:                         unset AI_PROVIDER or unset AI_DEBUG_OVERRIDE.
  const envProvider     = (process.env.AI_PROVIDER || null) as AIProvider | null;
  const isDebugOverride = process.env.AI_DEBUG_OVERRIDE === "true";
  const applyEnvOverride = envProvider && (routingMode !== "credits" || isDebugOverride);

  if (applyEnvOverride) {
    const envModel = process.env.AI_MODEL || null;
    const defaults = PROVIDER_DEFAULTS[envProvider!] ?? PROVIDER_DEFAULTS.openrouter;
    const model    = envModel ?? (modelKey === "smart" ? defaults.smartModel : defaults.fastModel);
    logger.warn(
      { provider: envProvider, model, routingMode, debugOverride: isDebugOverride,
        hint: "Remove AI_PROVIDER or unset AI_DEBUG_OVERRIDE to restore production credit routing" },
      "[AI] ⚠ ENV_OVERRIDE active — credit-based routing is bypassed",
    );
    return { provider: envProvider!, model, reason: "env_override" };
  }

  if (envProvider && !applyEnvOverride) {
    // AI_PROVIDER is set but credits routing mode is on and debug is not enabled — log and ignore.
    logger.debug(
      { envAI_PROVIDER: envProvider, routingMode, action: "ignored",
        hint: "Set AI_DEBUG_OVERRIDE=true alongside AI_PROVIDER to activate in credits mode" },
      "[AI] AI_PROVIDER env var present but ignored (credits routing active, debug override not set)",
    );
  }

  // ── 2. Fetch org data — single DB join for config + credits balance ────────
  // Reads from: org_config (aiProvider, aiModel, subscriptionTier)
  //             organizations (aiCreditsBalance)
  let orgProvider: string | null = null;
  let orgModel:    string | null = null;
  let creditsBalance             = 0;
  let tier                       = "free";

  if (orgId) {
    const [row] = await db
      .select({
        aiProvider:       orgConfigTable.aiProvider,
        aiModel:          orgConfigTable.aiModel,
        subscriptionTier: orgConfigTable.subscriptionTier,
        aiCreditsBalance: organizationsTable.aiCreditsBalance,
      })
      .from(orgConfigTable)
      .innerJoin(organizationsTable, eq(organizationsTable.id, orgConfigTable.organizationId))
      .where(eq(orgConfigTable.organizationId, orgId));

    orgProvider    = row?.aiProvider       ?? null;
    orgModel       = row?.aiModel          ?? null;
    tier           = row?.subscriptionTier ?? "free";
    creditsBalance = row?.aiCreditsBalance ?? 0;
  }

  // ── 3. Explicit per-org admin override ────────────────────────────────────
  // Admin has pinned this org to a specific provider in org_config.
  if (orgProvider && orgProvider !== "none" && orgProvider !== "auto") {
    const defaults = PROVIDER_DEFAULTS[orgProvider as AIProvider] ?? PROVIDER_DEFAULTS.openrouter;
    const model    = orgModel ?? (modelKey === "smart" ? defaults.smartModel : defaults.fastModel) ?? "";
    return { provider: orgProvider as AIProvider, model, reason: "org_override", creditsBalance, tier };
  }

  // ── 4. Credits-based routing (default production mode) ────────────────────
  if (routingMode === "credits") {
    const thresholdStr = await getSystemSettingValue("ai_credits_threshold");
    const threshold    = thresholdStr ? parseInt(thresholdStr, 10) : CREDITS_THRESHOLD_DEFAULT;

    if (creditsBalance >= threshold) {
      // ── Premium path ──────────────────────────────────────────────────────
      // Uses: system_settings.ai_premium_provider (default "openai" → OpenRouter)
      // Model priority: system_settings.ai_premium_model → AI_MODEL env → PREMIUM_MODEL_DEFAULT
      const premiumProvider = (
        (await getSystemSettingValue("ai_premium_provider")) ?? CREDITS_PREMIUM_PROVIDER_DEFAULT
      ) as AIProvider;
      const premiumModelDB = await getSystemSettingValue("ai_premium_model");
      const model          = premiumModelDB ?? (process.env.AI_MODEL || null) ?? PREMIUM_MODEL_DEFAULT;
      logger.debug(
        { provider: premiumProvider, model, creditsBalance, threshold, reason: "credits_premium",
          baseURL: getProviderBaseURL(premiumProvider) },
        "[AI] credit routing → premium",
      );
      return { provider: premiumProvider, model, reason: "credits_premium", creditsBalance, creditsThreshold: threshold, tier };
    } else {
      // ── Free path ─────────────────────────────────────────────────────────
      // Uses: system_settings.ai_free_provider (default "cloudflare")
      // No credits deducted for free-path calls.
      const freeProvider = (
        (await getSystemSettingValue("ai_free_provider")) ?? CREDITS_FREE_PROVIDER_DEFAULT
      ) as AIProvider;
      const fDefaults = PROVIDER_DEFAULTS[freeProvider] ?? PROVIDER_DEFAULTS.cloudflare;
      const model     = modelKey === "smart" ? fDefaults.smartModel : fDefaults.fastModel;
      logger.debug(
        { provider: freeProvider, model, creditsBalance, threshold, reason: "credits_free",
          baseURL: getProviderBaseURL(freeProvider) },
        "[AI] credit routing → free (low balance)",
      );
      return { provider: freeProvider, model, reason: "credits_free", creditsBalance, creditsThreshold: threshold, tier };
    }
  }

  // ── 5. Tier-based routing (explicit mode) ─────────────────────────────────
  if (routingMode === "tier") {
    const tierCfg = SUBSCRIPTION_TIERS[tier as SubscriptionTier];
    if (tierCfg) {
      const tierProvider = tierCfg.aiProvider as AIProvider;
      const tDefaults    = PROVIDER_DEFAULTS[tierProvider] ?? PROVIDER_DEFAULTS.cloudflare;
      const model        = tierCfg.aiModel ?? (modelKey === "smart" ? tDefaults.smartModel : tDefaults.fastModel);
      return { provider: tierProvider, model, reason: "tier_config", creditsBalance, tier };
    }
  }

  // ── 6. System-level fallback ──────────────────────────────────────────────
  const sysCfg = await getAIProviderConfig();
  return {
    provider: sysCfg.provider,
    model:    modelKey === "smart" ? sysCfg.smartModel : sysCfg.fastModel,
    reason:   "system_fallback",
    creditsBalance,
    tier,
  };
}

// ─── Single-provider executor ─────────────────────────────────────────────────

async function executeOnProvider(
  providerKey: string,
  model: string,
  systemPrompt: string,
  prompt: string,
): Promise<{ content: string; tokensUsed?: number; latencyMs: number }> {
  const start = Date.now();

  if (providerKey === "huggingface" || providerKey === "anthropic") {
    const { getProviderByKey } = await import("./ai-providers/index.js");
    const p = getProviderByKey(providerKey);
    if (!p?.isAvailable()) throw new Error(`${providerKey} provider not available (missing API key)`);
    const res = await p.chat(
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
  // ── Provider resolution via resolveProviderForOrg() ────────────────────────
  // Full priority chain: ENV override → org_config admin override → credits
  // routing (balance ≥ threshold → premium, < threshold → free) → fallback.
  const resolution = await resolveProviderForOrg(organizationId, modelKey);

  const primaryProvider = resolution.provider;
  const primaryModel    = resolution.model;
  const tierChain       = TIER_FALLBACK_CHAINS[resolution.tier ?? "free"] ?? FALLBACK_CHAIN;

  const chain: string[] = primaryProvider && primaryProvider !== "none"
    ? [primaryProvider, ...tierChain.filter(p => p !== primaryProvider)]
    : [...tierChain];

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
        logger.info({
          usedProvider:    providerKey,
          primaryProvider: chain[0],
          model,
          baseURL:         getProviderBaseURL(providerKey),
          reason:          resolution.reason,
          creditsBalance:  resolution.creditsBalance,
          latencyMs:       raw.latencyMs,
        }, "[AI] fallback provider used");
      } else {
        logger.info({
          provider:         providerKey,
          model,
          baseURL:          getProviderBaseURL(providerKey),
          reason:           resolution.reason,
          creditsBalance:   resolution.creditsBalance,
          creditsThreshold: resolution.creditsThreshold,
          latencyMs:        raw.latencyMs,
          tokens:           raw.tokensUsed,
        }, "[AI] call completed");
      }

      return {
        data:             parseAIContent(raw.content, jsonMode),
        provider:         providerKey,
        model,
        tokensUsed:       raw.tokensUsed,
        latencyMs:        raw.latencyMs,
        usedFallback:     i > 0,
        tier:             FREE_TIER_PROVIDERS.has(providerKey) ? "free" : "premium",
        upgradeAvailable: false, // callAI() always uses the resolved provider; complexity gating is in /command only
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
