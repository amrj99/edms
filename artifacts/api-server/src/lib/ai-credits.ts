import { db } from "@workspace/db";
import { organizationsTable, aiCreditTransactionsTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger.js";

// ─── Feature credit costs ─────────────────────────────────────────────────────
// Adjust these values without schema changes.
export const AI_FEATURE_COSTS = {
  ai_summary:  10,
  ai_classify: 5,
  ai_extract:  15,
  ai_search:   2,
} as const;

export type AiFeature = keyof typeof AI_FEATURE_COSTS;

// ─── Credit packs (one-time purchase) ─────────────────────────────────────────
export interface AiCreditPack {
  id: string;
  name: string;
  credits: number;
  stripePriceEnv: string;
  description: string;
}

export const AI_CREDIT_PACKS: AiCreditPack[] = [
  {
    id: "ai_pack_small",
    name: "Small AI Pack",
    credits: 1_000,
    stripePriceEnv: "STRIPE_AI_PACK_SMALL_PRICE_ID",
    description: "1,000 AI credits — ideal for light usage",
  },
  {
    id: "ai_pack_medium",
    name: "Medium AI Pack",
    credits: 5_000,
    stripePriceEnv: "STRIPE_AI_PACK_MEDIUM_PRICE_ID",
    description: "5,000 AI credits — best value for regular use",
  },
  {
    id: "ai_pack_large",
    name: "Large AI Pack",
    credits: 20_000,
    stripePriceEnv: "STRIPE_AI_PACK_LARGE_PRICE_ID",
    description: "20,000 AI credits — for high-volume teams",
  },
];

export const INITIAL_FREE_CREDITS = 1_000;

// ─── Get current balance ───────────────────────────────────────────────────────
export async function getCreditsBalance(orgId: number): Promise<{ balance: number; totalPurchased: number }> {
  const [org] = await db
    .select({ balance: organizationsTable.aiCreditsBalance, totalPurchased: organizationsTable.aiCreditsTotalPurchased })
    .from(organizationsTable)
    .where(eq(organizationsTable.id, orgId));

  return { balance: org?.balance ?? 0, totalPurchased: org?.totalPurchased ?? 0 };
}

// ─── Atomic credit deduction ───────────────────────────────────────────────────
// Uses a single UPDATE … WHERE ai_credits_balance >= cost to prevent races.
// Returns true if credits were deducted; false if insufficient balance.
export async function deductCredits(
  orgId: number,
  feature: AiFeature,
  metadata?: Record<string, unknown>,
): Promise<boolean> {
  const cost = AI_FEATURE_COSTS[feature];

  const result = await db
    .update(organizationsTable)
    .set({
      aiCreditsBalance: sql`${organizationsTable.aiCreditsBalance} - ${cost}`,
      updatedAt: new Date(),
    })
    .where(
      sql`${organizationsTable.id} = ${orgId}
          AND ${organizationsTable.aiCreditsBalance} >= ${cost}`,
    )
    .returning({ newBalance: organizationsTable.aiCreditsBalance });

  if (result.length === 0) {
    logger.warn({ orgId, feature, cost }, "AI credit deduction failed — insufficient balance");
    return false;
  }

  await db.insert(aiCreditTransactionsTable).values({
    organizationId: orgId,
    amount: -cost,
    transactionType: "consumption",
    feature: feature as any,
    metadata: metadata ?? null,
  });

  logger.debug({ orgId, feature, cost, newBalance: result[0].newBalance }, "AI credits deducted");
  return true;
}

// ─── Grant credits ─────────────────────────────────────────────────────────────
// Used for purchases and initial free grants.
export async function grantCredits(
  orgId: number,
  amount: number,
  type: "purchase" | "grant",
  metadata?: Record<string, unknown>,
): Promise<number> {
  const [updated] = await db
    .update(organizationsTable)
    .set({
      aiCreditsBalance: sql`${organizationsTable.aiCreditsBalance} + ${amount}`,
      aiCreditsTotalPurchased: type === "purchase"
        ? sql`${organizationsTable.aiCreditsTotalPurchased} + ${amount}`
        : organizationsTable.aiCreditsTotalPurchased,
      updatedAt: new Date(),
    })
    .where(eq(organizationsTable.id, orgId))
    .returning({ newBalance: organizationsTable.aiCreditsBalance });

  await db.insert(aiCreditTransactionsTable).values({
    organizationId: orgId,
    amount,
    transactionType: type,
    feature: null,
    metadata: metadata ?? null,
  });

  logger.info({ orgId, amount, type, newBalance: updated.newBalance }, "AI credits granted");
  return updated.newBalance;
}
