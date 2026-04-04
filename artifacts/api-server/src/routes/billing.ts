import { Router } from "express";
import Stripe from "stripe";
import { requireAuth } from "../lib/auth.js";
import { db } from "@workspace/db";
import { organizationsTable, systemSettingsTable } from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router = Router();

// ─── Plans config ────────────────────────────────────────────────────────────
export const PLANS = [
  {
    id: "starter",
    name: "Starter",
    description: "Essential document management for small teams",
    priceAed: 45,
    currency: "aed",
    interval: "month",
    features: [
      "Up to 10 users",
      "5 GB storage",
      "Basic transmittal management",
      "Standard support",
      "Document versioning",
    ],
    maxUsers: 10,
    storageMb: 5120,
    stripePriceEnv: "STRIPE_PRICE_STARTER",
  },
  {
    id: "basic",
    name: "Basic",
    description: "Full EDMS for growing engineering teams",
    priceAed: 65,
    currency: "aed",
    interval: "month",
    features: [
      "Up to 25 users",
      "25 GB storage",
      "Transmittal & register management",
      "Email support",
      "AI-assisted linking",
      "Rules engine",
    ],
    maxUsers: 25,
    storageMb: 25600,
    stripePriceEnv: "STRIPE_PRICE_BASIC",
    popular: true,
  },
  {
    id: "professional",
    name: "Professional",
    description: "Advanced EDMS for large projects",
    priceAed: 80,
    currency: "aed",
    interval: "month",
    features: [
      "Up to 100 users",
      "100 GB storage",
      "All registers (ITR, NCR, NOC)",
      "Priority support",
      "Advanced analytics",
      "Custom workflows",
      "API access",
    ],
    maxUsers: 100,
    storageMb: 102400,
    stripePriceEnv: "STRIPE_PRICE_PROFESSIONAL",
  },
  {
    id: "enterprise",
    name: "Enterprise",
    description: "Unlimited scale for large organisations",
    priceAed: 95,
    currency: "aed",
    interval: "month",
    features: [
      "Unlimited users",
      "1 TB storage",
      "All features",
      "Dedicated support",
      "SLA guarantee",
      "On-premise option",
      "Custom integrations",
      "SSO / SAML",
    ],
    maxUsers: null,
    storageMb: 1048576,
    stripePriceEnv: "STRIPE_PRICE_ENTERPRISE",
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key, { apiVersion: "2025-03-31.basil" });
}

async function getOrgStripeData(orgId: number): Promise<Record<string, string>> {
  const rows = await db
    .select()
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, `stripe_org_${orgId}`));
  if (rows.length === 0) return {};
  try { return JSON.parse(rows[0].value); } catch { return {}; }
}

async function setOrgStripeData(orgId: number, data: Record<string, string>) {
  const key = `stripe_org_${orgId}`;
  const existing = await db
    .select()
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, key));
  const value = JSON.stringify(data);
  if (existing.length > 0) {
    await db.update(systemSettingsTable).set({ value, updatedAt: new Date() }).where(eq(systemSettingsTable.key, key));
  } else {
    await db.insert(systemSettingsTable).values({ key, value });
  }
}

// ─── GET /api/billing/plans ───────────────────────────────────────────────────
router.get("/plans", (_req, res) => {
  res.json({ plans: PLANS });
});

// ─── GET /api/billing/status ──────────────────────────────────────────────────
router.get("/status", requireAuth, async (req, res) => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(400).json({ message: "No organisation context" });

    const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, orgId));
    if (!org) return res.status(404).json({ message: "Organisation not found" });

    const stripeData = await getOrgStripeData(orgId);
    const currentPlan = PLANS.find(p => p.id === org.subscriptionTier) ?? null;

    const stripe = getStripe();
    let subscriptionStatus = "inactive";
    let currentPeriodEnd: string | null = null;
    let seats = 0;

    if (stripe && stripeData.subscriptionId) {
      try {
        const sub = await stripe.subscriptions.retrieve(stripeData.subscriptionId);
        subscriptionStatus = sub.status;
        currentPeriodEnd = new Date((sub as any).current_period_end * 1000).toISOString();
        seats = (sub as any).items?.data?.[0]?.quantity ?? 0;
      } catch (e) {
        logger.warn("Failed to retrieve Stripe subscription", e);
      }
    }

    res.json({
      tier: org.subscriptionTier ?? "free",
      plan: currentPlan,
      subscriptionStatus,
      currentPeriodEnd,
      seats,
      stripeCustomerId: stripeData.customerId ?? null,
      stripeSubscriptionId: stripeData.subscriptionId ?? null,
    });
  } catch (err) {
    logger.error(err, "billing status error");
    res.status(500).json({ message: "Internal server error" });
  }
});

// ─── POST /api/billing/checkout ───────────────────────────────────────────────
router.post("/checkout", requireAuth, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ message: "Stripe is not configured. Connect Stripe to enable billing." });

  try {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(400).json({ message: "No organisation context" });

    const { planId, seats = 1, successUrl, cancelUrl } = req.body as {
      planId: string; seats: number; successUrl: string; cancelUrl: string;
    };

    const plan = PLANS.find(p => p.id === planId);
    if (!plan) return res.status(400).json({ message: "Invalid plan" });

    const priceId = process.env[plan.stripePriceEnv];
    if (!priceId) return res.status(503).json({ message: `Stripe price for ${plan.name} not configured` });

    const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, orgId));
    if (!org) return res.status(404).json({ message: "Organisation not found" });

    const stripeData = await getOrgStripeData(orgId);
    let customerId = stripeData.customerId;

    if (!customerId) {
      const customer = await stripe.customers.create({
        name: org.name,
        email: org.contactEmail ?? undefined,
        metadata: { orgId: String(orgId) },
      });
      customerId = customer.id;
      await setOrgStripeData(orgId, { ...stripeData, customerId });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: seats }],
      success_url: successUrl ?? `${process.env.APP_URL ?? ""}/billing?success=true`,
      cancel_url: cancelUrl ?? `${process.env.APP_URL ?? ""}/billing?canceled=true`,
      metadata: { orgId: String(orgId), planId },
      subscription_data: { metadata: { orgId: String(orgId), planId } },
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err: any) {
    logger.error(err, "billing checkout error");
    res.status(500).json({ message: err.message ?? "Checkout failed" });
  }
});

// ─── POST /api/billing/portal ─────────────────────────────────────────────────
router.post("/portal", requireAuth, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ message: "Stripe is not configured" });

  try {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(400).json({ message: "No organisation context" });

    const stripeData = await getOrgStripeData(orgId);
    if (!stripeData.customerId) return res.status(400).json({ message: "No Stripe customer found for this organisation" });

    const { returnUrl } = req.body as { returnUrl?: string };
    const session = await stripe.billingPortal.sessions.create({
      customer: stripeData.customerId,
      return_url: returnUrl ?? `${process.env.APP_URL ?? ""}/billing`,
    });

    res.json({ url: session.url });
  } catch (err: any) {
    logger.error(err, "billing portal error");
    res.status(500).json({ message: err.message ?? "Portal failed" });
  }
});

// ─── POST /api/billing/webhook ────────────────────────────────────────────────
// Must be mounted with express.raw() — see app.ts / index.ts
router.post(
  "/webhook",
  (req, res, next) => {
    // Allow raw body if already parsed; express.raw is set up in app
    next();
  },
  async (req, res) => {
    const stripe = getStripe();
    if (!stripe) return res.status(503).send("Stripe not configured");

    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event: Stripe.Event;
    try {
      event = webhookSecret && sig
        ? stripe.webhooks.constructEvent(req.body, sig as string, webhookSecret)
        : JSON.parse(req.body.toString());
    } catch (err: any) {
      logger.warn(`Webhook signature verification failed: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          const orgId = parseInt(session.metadata?.orgId ?? "0");
          const planId = session.metadata?.planId ?? "free";
          const subscriptionId = session.subscription as string;
          if (orgId && subscriptionId) {
            const existing = await getOrgStripeData(orgId);
            await setOrgStripeData(orgId, { ...existing, subscriptionId, planId, customerId: session.customer as string });
            await db.update(organizationsTable).set({ subscriptionTier: planId, updatedAt: new Date() }).where(eq(organizationsTable.id, orgId));
            logger.info({ orgId, planId, subscriptionId }, "Subscription activated via checkout");
          }
          break;
        }
        case "customer.subscription.updated": {
          const sub = event.data.object as Stripe.Subscription;
          const orgId = parseInt(sub.metadata?.orgId ?? "0");
          const planId = sub.metadata?.planId ?? "";
          if (orgId) {
            const existing = await getOrgStripeData(orgId);
            await setOrgStripeData(orgId, { ...existing, subscriptionId: sub.id, planId: planId || existing.planId });
            if (planId) {
              await db.update(organizationsTable).set({ subscriptionTier: planId, updatedAt: new Date() }).where(eq(organizationsTable.id, orgId));
            }
            logger.info({ orgId, status: sub.status }, "Subscription updated");
          }
          break;
        }
        case "customer.subscription.deleted": {
          const sub = event.data.object as Stripe.Subscription;
          const orgId = parseInt(sub.metadata?.orgId ?? "0");
          if (orgId) {
            const existing = await getOrgStripeData(orgId);
            await setOrgStripeData(orgId, { ...existing, subscriptionId: sub.id, planId: "free" });
            await db.update(organizationsTable).set({ subscriptionTier: "free", updatedAt: new Date() }).where(eq(organizationsTable.id, orgId));
            logger.info({ orgId }, "Subscription cancelled — reverted to free");
          }
          break;
        }
        case "invoice.payment_failed": {
          const invoice = event.data.object as Stripe.Invoice;
          logger.warn({ customerId: invoice.customer, invoiceId: invoice.id }, "Invoice payment failed");
          break;
        }
        default:
          logger.debug({ type: event.type }, "Unhandled Stripe webhook event");
      }

      res.json({ received: true });
    } catch (err) {
      logger.error(err, "Webhook handler error");
      res.status(500).json({ message: "Webhook processing failed" });
    }
  }
);

export default router;
