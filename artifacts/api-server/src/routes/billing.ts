import { Router } from "express";
import Stripe from "stripe";
import { requireAuth } from "../lib/auth.js";
import { db } from "@workspace/db";
import {
  organizationsTable,
  systemSettingsTable,
  subscriptionsTable,
  orgConfigTable,
  usersTable,
  projectsTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { PLANS, getDefaultModulesForPlan } from "../lib/plans.js";
import { getOrgPlan } from "../lib/plan-service.js";
import { isExpiredPlan } from "../lib/plan-normalizer.js";
import { grantCredits, AI_CREDIT_PACKS } from "../lib/ai-credits.js";
import { createAuditLog } from "../lib/audit.js";

export { PLANS };

const router = Router();

// ─── Stripe client ────────────────────────────────────────────────────────────
function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key, { apiVersion: "2025-03-31.basil" });
}

// ─── Legacy system_settings helpers (kept for checkout/portal customer lookup) ─
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
  const existing = await db.select().from(systemSettingsTable).where(eq(systemSettingsTable.key, key));
  const value = JSON.stringify(data);
  if (existing.length > 0) {
    await db.update(systemSettingsTable).set({ value, updatedAt: new Date() }).where(eq(systemSettingsTable.key, key));
  } else {
    await db.insert(systemSettingsTable).values({ key, value });
  }
}

// ─── Subscriptions table helpers ──────────────────────────────────────────────
async function upsertSubscription(orgId: number, data: Partial<typeof subscriptionsTable.$inferInsert>) {
  const [existing] = await db
    .select({ id: subscriptionsTable.id })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.organizationId, orgId));

  if (existing) {
    const [updated] = await db
      .update(subscriptionsTable)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(subscriptionsTable.organizationId, orgId))
      .returning();
    return updated;
  } else {
    const [inserted] = await db
      .insert(subscriptionsTable)
      .values({ organizationId: orgId, ...data })
      .returning();
    return inserted;
  }
}

// ─── Restore users + projects after an upgrade out of the free/trial tier ─────
// Called whenever an org successfully moves to a paid plan (Stripe webhook or
// manual admin action). Always resets the read-only state set by the trial
// downgrade scheduler so the org immediately regains full access.
//
// Idempotent: setting false→false or true→false is always safe.
// Does NOT discriminate by plan — the caller is responsible for ensuring
// this is only invoked on genuine upgrades (i.e. not on "free" plan assignments).
export async function upgradeOrgFromFree(orgId: number): Promise<void> {
  await db
    .update(usersTable)
    .set({ isReadOnlyOverride: false, updatedAt: new Date() })
    .where(eq(usersTable.organizationId, orgId));

  await db
    .update(projectsTable)
    .set({ visibleOnFree: true, updatedAt: new Date() })
    .where(eq(projectsTable.organizationId, orgId));

  logger.info({ orgId }, "[billing] upgradeOrgFromFree: users and projects restored");

  // Audit log — fire-and-forget, never blocks or throws
  await createAuditLog({
    organizationId: orgId,
    action: "upgraded_from_free",
    entityType: "organization",
    entityId: orgId,
    details: { upgradedAt: new Date().toISOString() },
  });
}

async function applyModulesForPlan(orgId: number, planId: string) {
  const modules = getDefaultModulesForPlan(planId);
  const [existingConfig] = await db
    .select({ id: orgConfigTable.id })
    .from(orgConfigTable)
    .where(eq(orgConfigTable.organizationId, orgId));

  if (existingConfig) {
    await db
      .update(orgConfigTable)
      .set({ modules, updatedAt: new Date() })
      .where(eq(orgConfigTable.organizationId, orgId));
  } else {
    await db.insert(orgConfigTable).values({ organizationId: orgId, modules });
  }
}

// ─── GET /api/billing/plans ───────────────────────────────────────────────────
router.get("/plans", (_req, res) => {
  res.json({ plans: PLANS });
});

// ─── GET /api/billing/status ──────────────────────────────────────────────────
router.get("/status", requireAuth, async (req, res): Promise<void> => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(400).json({ message: "No organisation context" });

    const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, orgId));
    if (!org) return res.status(404).json({ message: "Organisation not found" });

    // Primary: read from subscriptions table
    let [sub] = await db.select().from(subscriptionsTable).where(eq(subscriptionsTable.organizationId, orgId));

    // Lazy migration: if no subscriptions row but system_settings data exists, migrate it
    if (!sub) {
      const legacyData = await getOrgStripeData(orgId);
      if (legacyData.subscriptionId || legacyData.customerId) {
        // Phase 1: resolve the plan via SSOT (falls back to org.subscriptionTier with WARN)
        const resolvedPlanId = legacyData.planId ?? await getOrgPlan(orgId);
        sub = await upsertSubscription(orgId, {
          planId: resolvedPlanId,
          stripeCustomerId: legacyData.customerId ?? null,
          stripeSubscriptionId: legacyData.subscriptionId ?? null,
          status: legacyData.subscriptionId ? "active" : "expired",
        });
        logger.info({ orgId, resolvedPlanId }, "Lazily migrated subscription from system_settings to subscriptions table");
      }
    }

    // Phase 1: resolve tier from SSOT (subscriptions.plan_id → fallback to org.subscription_tier).
    // If sub exists we already have the plan_id; getOrgPlan avoids a redundant DB call.
    const tier = sub?.planId ?? await getOrgPlan(orgId);
    const currentPlan = PLANS.find(p => p.id === tier) ?? null;

    // Try to refresh live status from Stripe if configured
    const stripe = getStripe();
    let subscriptionStatus: string = sub?.status ?? "expired";
    let currentPeriodEnd: string | null = sub?.currentPeriodEnd?.toISOString() ?? null;
    let seats: number = sub?.seatsCount ?? 0;

    if (stripe && sub?.stripeSubscriptionId) {
      try {
        const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
        subscriptionStatus = stripeSub.status;
        currentPeriodEnd = new Date((stripeSub as any).current_period_end * 1000).toISOString();
        seats = (stripeSub as any).items?.data?.[0]?.quantity ?? 1;
        // Keep subscriptions table in sync
        await upsertSubscription(orgId, {
          status: stripeSub.status as any,
          currentPeriodEnd: new Date((stripeSub as any).current_period_end * 1000),
          currentPeriodStart: new Date((stripeSub as any).current_period_start * 1000),
          seatsCount: seats,
        });
      } catch (e) {
        logger.warn("Failed to retrieve Stripe subscription", e);
      }
    }

    // ── Storage warning level ────────────────────────────────────────────────
    // Computed server-side so the frontend never needs to replicate this logic.
    // Thresholds: 80 % → warning, 95 % → critical, 100 % → full.
    const storageUsedMb  = org.storageUsedMb ?? 0;
    const storageLimitMb = currentPlan?.storageMb ?? null;
    let storageWarningLevel: "warning" | "critical" | "full" | null = null;
    if (storageLimitMb && storageLimitMb > 0) {
      const pct = (storageUsedMb / storageLimitMb) * 100;
      if (pct >= 100)      storageWarningLevel = "full";
      else if (pct >= 95)  storageWarningLevel = "critical";
      else if (pct >= 80)  storageWarningLevel = "warning";
    }

    res.json({
      tier,
      plan: currentPlan,
      subscriptionStatus,
      currentPeriodEnd,
      seats,
      paymentFailedAt: sub?.paymentFailedAt?.toISOString() ?? null,
      stripeCustomerId: sub?.stripeCustomerId ?? null,
      stripeSubscriptionId: sub?.stripeSubscriptionId ?? null,
      storageUsedMb,
      storageLimitMb,
      maxUsers: currentPlan?.maxUsers ?? null,
      trialEndsAt: org.trialEndsAt?.toISOString() ?? null,
      storageWarningLevel,
    });
  } catch (err) {
    logger.error(err, "billing status error");
    res.status(500).json({ message: "Internal server error" });
  }
});

// ─── POST /api/billing/checkout ───────────────────────────────────────────────
router.post("/checkout", requireAuth, async (req, res): Promise<void> => {
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

    if (plan.minUsers && seats < plan.minUsers) {
      return res.status(400).json({
        message: `The ${plan.name} plan requires a minimum of ${plan.minUsers} seat${plan.minUsers !== 1 ? "s" : ""}.`,
      });
    }

    const priceId = process.env[plan.stripePriceEnv];
    if (!priceId) return res.status(503).json({ message: `Stripe price for ${plan.name} not configured` });

    const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, orgId));
    if (!org) return res.status(404).json({ message: "Organisation not found" });

    const stripeData = await getOrgStripeData(orgId);
    let customerId = stripeData.customerId;

    if (!customerId) {
      const [existingSub] = await db.select({ stripeCustomerId: subscriptionsTable.stripeCustomerId })
        .from(subscriptionsTable).where(eq(subscriptionsTable.organizationId, orgId));
      customerId = existingSub?.stripeCustomerId ?? undefined;
    }

    if (!customerId) {
      const customer = await stripe.customers.create({
        name: org.name,
        email: org.contactEmail ?? undefined,
        metadata: { orgId: String(orgId) },
      });
      customerId = customer.id;
      await setOrgStripeData(orgId, { ...stripeData, customerId });
      await upsertSubscription(orgId, { stripeCustomerId: customerId });
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
router.post("/portal", requireAuth, async (req, res): Promise<void> => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ message: "Stripe is not configured" });

  try {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(400).json({ message: "No organisation context" });

    const stripeData = await getOrgStripeData(orgId);
    let customerId = stripeData.customerId;

    if (!customerId) {
      const [sub] = await db.select({ stripeCustomerId: subscriptionsTable.stripeCustomerId })
        .from(subscriptionsTable).where(eq(subscriptionsTable.organizationId, orgId));
      customerId = sub?.stripeCustomerId ?? undefined;
    }

    if (!customerId) return res.status(400).json({ message: "No Stripe customer found for this organisation" });

    const { returnUrl } = req.body as { returnUrl?: string };
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl ?? `${process.env.APP_URL ?? ""}/billing`,
    });

    res.json({ url: session.url });
  } catch (err: any) {
    logger.error(err, "billing portal error");
    res.status(500).json({ message: err.message ?? "Portal failed" });
  }
});

// ─── POST /api/billing/webhook ────────────────────────────────────────────────
// Must be mounted with express.raw() — see app.ts
router.post(
  "/webhook",
  (req, res, next) => { next(); },
  async (req, res): Promise<void> => {
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

          // ── AI credit pack purchase (one-time payment) ─────────────────────
          if (session.metadata?.type === "ai_credit_pack" && orgId) {
            const packId = session.metadata.packId;
            const credits = parseInt(session.metadata.credits ?? "0");
            const pack = AI_CREDIT_PACKS.find(p => p.id === packId);
            if (pack && credits > 0) {
              await grantCredits(orgId, credits, "purchase", {
                packId,
                stripeSessionId: session.id,
                amountTotal: session.amount_total,
              });
              logger.info({ orgId, packId, credits }, "AI credits granted via pack purchase");
            } else {
              logger.warn({ orgId, packId, credits }, "AI credit pack purchase: unknown pack or zero credits");
            }
            break;
          }

          const planId = session.metadata?.planId ?? "expired";
          const subscriptionId = session.subscription as string;
          const customerId = session.customer as string;

          if (orgId && subscriptionId) {
            // Keep legacy system_settings for portal customer lookup
            const legacyExisting = await getOrgStripeData(orgId);
            await setOrgStripeData(orgId, { ...legacyExisting, subscriptionId, planId, customerId });

            // Write to subscriptions table
            let periodStart: Date | null = null;
            let periodEnd: Date | null = null;
            let seats = 1;
            try {
              const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
              periodStart = new Date((stripeSub as any).current_period_start * 1000);
              periodEnd   = new Date((stripeSub as any).current_period_end   * 1000);
              seats       = (stripeSub as any).items?.data?.[0]?.quantity ?? 1;
            } catch { /* ignore */ }

            await upsertSubscription(orgId, {
              planId,
              stripeCustomerId: customerId,
              stripeSubscriptionId: subscriptionId,
              status: "active",
              currentPeriodStart: periodStart,
              currentPeriodEnd: periodEnd,
              seatsCount: seats,
              paymentFailedAt: null,
            });

            // Keep org.subscriptionTier in sync
            await db.update(organizationsTable)
              .set({ subscriptionTier: planId, updatedAt: new Date() })
              .where(eq(organizationsTable.id, orgId));

            // Auto-apply module flags for this plan
            await applyModulesForPlan(orgId, planId);

            // Restore users + projects visibility — org is upgrading from free/trial
            await upgradeOrgFromFree(orgId);

            logger.info({ orgId, planId, subscriptionId }, "Subscription activated via checkout");
          }
          break;
        }

        case "customer.subscription.updated": {
          const sub = event.data.object as Stripe.Subscription;
          const orgId = parseInt(sub.metadata?.orgId ?? "0");
          const planId = sub.metadata?.planId ?? "";

          if (orgId) {
            const legacyExisting = await getOrgStripeData(orgId);
            await setOrgStripeData(orgId, { ...legacyExisting, subscriptionId: sub.id, planId: planId || legacyExisting.planId });

            const resolvedPlanId = planId || legacyExisting.planId || "expired";
            await upsertSubscription(orgId, {
              stripeSubscriptionId: sub.id,
              planId: resolvedPlanId,
              status: sub.status as any,
              currentPeriodStart: new Date((sub as any).current_period_start * 1000),
              currentPeriodEnd: new Date((sub as any).current_period_end * 1000),
              seatsCount: (sub as any).items?.data?.[0]?.quantity ?? 1,
              paymentFailedAt: null,
            });

            if (planId) {
              await db.update(organizationsTable)
                .set({ subscriptionTier: planId, updatedAt: new Date() })
                .where(eq(organizationsTable.id, orgId));
              await applyModulesForPlan(orgId, planId);
              // Restore users + projects visibility if upgrading from expired/trial.
              // Guard against downgrade events (e.g. plan change back to expired) by
              // only calling upgradeOrgFromFree when the incoming plan is not expired.
              if (!isExpiredPlan(planId)) await upgradeOrgFromFree(orgId);
            }

            logger.info({ orgId, status: sub.status, planId: resolvedPlanId }, "Subscription updated");
          }
          break;
        }

        case "customer.subscription.deleted": {
          const sub = event.data.object as Stripe.Subscription;
          const orgId = parseInt(sub.metadata?.orgId ?? "0");

          if (orgId) {
            const legacyExisting = await getOrgStripeData(orgId);
            await setOrgStripeData(orgId, { ...legacyExisting, subscriptionId: sub.id, planId: "expired" });

            await upsertSubscription(orgId, {
              planId: "expired",
              status: "canceled",
              stripeSubscriptionId: sub.id,
              currentPeriodEnd: null,
              currentPeriodStart: null,
            });

            await db.update(organizationsTable)
              .set({ subscriptionTier: "expired", updatedAt: new Date() })
              .where(eq(organizationsTable.id, orgId));

            // Reset modules to expired-tier mapping
            await applyModulesForPlan(orgId, "expired");

            logger.info({ orgId }, "Subscription cancelled — reverted to expired");
          }
          break;
        }

        case "invoice.payment_failed": {
          const invoice = event.data.object as Stripe.Invoice;
          const customerId = invoice.customer as string;

          if (customerId) {
            // Find the org via stripeCustomerId in subscriptions table
            const [sub] = await db
              .select({ organizationId: subscriptionsTable.organizationId })
              .from(subscriptionsTable)
              .where(eq(subscriptionsTable.stripeCustomerId, customerId));

            if (sub?.organizationId) {
              await upsertSubscription(sub.organizationId, {
                status: "past_due",
                paymentFailedAt: new Date(),
              });
              logger.warn({ orgId: sub.organizationId, customerId, invoiceId: invoice.id }, "Payment failed — subscription marked past_due");
            } else {
              logger.warn({ customerId, invoiceId: invoice.id }, "invoice.payment_failed: no matching org found");
            }
          }
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
