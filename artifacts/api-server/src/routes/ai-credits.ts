import { Router } from "express";
import Stripe from "stripe";
import { requireAuth } from "../lib/auth.js";
import { isSysAdmin } from "../lib/auth.js";
import { db } from "@workspace/db";
import { organizationsTable, aiCreditTransactionsTable } from "@workspace/db/schema";
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

function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

// ─── GET /api/ai-credits/balance ──────────────────────────────────────────────
router.get("/balance", requireAuth, async (req, res): Promise<void> => {
  const orgId = req.user!.organizationId;
  if (!orgId) { res.status(400).json({ message: "No organisation context" }); return; }

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
});

// ─── GET /api/ai-credits/packs ────────────────────────────────────────────────
router.get("/packs", requireAuth, (_req, res) => {
  const stripeConfigured = isStripeConfigured();
  res.json({
    packs: AI_CREDIT_PACKS.map(p => ({ ...p, stripePriceEnv: undefined })),
    stripeConfigured,
  });
});

// ─── POST /api/ai-credits/purchase ────────────────────────────────────────────
// Creates a Stripe Checkout session in one-time payment mode (not subscription).
router.post("/purchase", requireAuth, async (req, res): Promise<void> => {
  const stripe = getStripe();
  if (!stripe) {
    res.status(503).json({ message: "Stripe is not configured. Contact your administrator." })
    return;
  }

    const orgId = req.user!.organizationId;
    if (!orgId) { res.status(400).json({ message: "No organisation context" }); return; }

    const { packId, successUrl, cancelUrl } = req.body as {
      packId: string;
      successUrl?: string;
      cancelUrl?: string;
    };

    const pack = AI_CREDIT_PACKS.find(p => p.id === packId);
    if (!pack) { res.status(400).json({ message: "Invalid AI credit pack" }); return; }

    const priceId = process.env[pack.stripePriceEnv];
    if (!priceId) {
      res.status(503).json({ message: `Stripe price for "${pack.name}" is not configured` })
    return;
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
});

// ─── GET /api/ai-credits/admin/balances ───────────────────────────────────────
// Returns credit balances for all organisations. Admin / system_owner only.
router.get("/admin/balances", requireAuth, async (req, res): Promise<void> => {
  if (!isSysAdmin(req.user!)) {
    res.status(403).json({ error: "Forbidden" })
    return;
  }

  const orgs = await db
    .select({
      id: organizationsTable.id,
      name: organizationsTable.name,
      balance: organizationsTable.aiCreditsBalance,
      totalPurchased: organizationsTable.aiCreditsTotalPurchased,
    })
    .from(organizationsTable)
    .orderBy(organizationsTable.name);

  res.json({ organizations: orgs });
});

// ─── POST /api/ai-credits/admin/grant ─────────────────────────────────────────
// Manually grants AI credits to an organisation. Admin / system_owner only.
// Records grantedBy (admin user ID + email) in the transaction metadata.
router.post("/admin/grant", requireAuth, async (req, res): Promise<void> => {
  if (!isSysAdmin(req.user!)) {
    res.status(403).json({ error: "Forbidden" })
    return;
  }

  const { organizationId, amount, note } = req.body as {
    organizationId: number;
    amount: number;
    note?: string;
  };

  if (!organizationId || !amount || amount <= 0) {
    res.status(400).json({
      message: "organizationId and a positive amount are required",
    })
    return;
  }

  if (!Number.isInteger(amount) || amount > 1_000_000) {
    res.status(400).json({
      message: "Amount must be a whole number no greater than 1,000,000",
    })
    return;
  }

  const [org] = await db
    .select({ id: organizationsTable.id, name: organizationsTable.name })
    .from(organizationsTable)
    .where(eq(organizationsTable.id, organizationId));

  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }

  const newBalance = await grantCredits(organizationId, amount, "grant", {
    grantedBy: req.user!.id,
    grantedByEmail: req.user!.email,
    note: note?.trim() ?? null,
    manual: true,
  });

  logger.info(
    { adminId: req.user!.id, adminEmail: req.user!.email, orgId: organizationId, orgName: org.name, amount, note },
    "AI credits manually granted by admin",
  );

  res.json({ newBalance, organizationId, organizationName: org.name, amount });
});

export default router;
