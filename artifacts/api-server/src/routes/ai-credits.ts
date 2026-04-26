import { Router } from "express";
import Stripe from "stripe";
import { requireAuth } from "../lib/auth.js";
import { db } from "@workspace/db";
import { aiCreditTransactionsTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import {
  getCreditsBalance,
  grantCredits,
  AI_FEATURE_COSTS,
  AI_CREDIT_PACKS,
} from "../lib/ai-credits.js";

const router = Router();

function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key, { apiVersion: "2025-03-31.basil" });
}

// ─── GET /api/ai-credits/balance ──────────────────────────────────────────────
router.get("/balance", requireAuth, async (req, res) => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(400).json({ message: "No organisation context" });

    const { balance, totalPurchased } = await getCreditsBalance(orgId);

    const recentTransactions = await db
      .select()
      .from(aiCreditTransactionsTable)
      .where(eq(aiCreditTransactionsTable.organizationId, orgId))
      .orderBy(desc(aiCreditTransactionsTable.createdAt))
      .limit(20);

    res.json({
      balance,
      totalPurchased,
      featureCosts: AI_FEATURE_COSTS,
      recentTransactions,
    });
  } catch (err) {
    logger.error(err, "ai-credits balance error");
    res.status(500).json({ message: "Internal server error" });
  }
});

// ─── GET /api/ai-credits/packs ────────────────────────────────────────────────
router.get("/packs", requireAuth, (_req, res) => {
  res.json({ packs: AI_CREDIT_PACKS.map(p => ({ ...p, stripePriceEnv: undefined })) });
});

// ─── POST /api/ai-credits/purchase ────────────────────────────────────────────
// Creates a Stripe Checkout session in one-time payment mode (not subscription).
router.post("/purchase", requireAuth, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) {
    return res.status(503).json({ message: "Stripe is not configured. Contact your administrator." });
  }

  try {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(400).json({ message: "No organisation context" });

    const { packId, successUrl, cancelUrl } = req.body as {
      packId: string;
      successUrl?: string;
      cancelUrl?: string;
    };

    const pack = AI_CREDIT_PACKS.find(p => p.id === packId);
    if (!pack) return res.status(400).json({ message: "Invalid AI credit pack" });

    const priceId = process.env[pack.stripePriceEnv];
    if (!priceId) {
      return res.status(503).json({ message: `Stripe price for "${pack.name}" is not configured` });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl ?? `${process.env.APP_URL ?? ""}/billing?ai_success=true`,
      cancel_url: cancelUrl ?? `${process.env.APP_URL ?? ""}/billing?ai_canceled=true`,
      metadata: {
        orgId: String(orgId),
        packId,
        credits: String(pack.credits),
        type: "ai_credit_pack",
      },
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err: any) {
    logger.error(err, "ai-credits purchase error");
    res.status(500).json({ message: err.message ?? "Purchase failed" });
  }
});

export default router;
