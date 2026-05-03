export interface PlanConfig {
  id: string;
  name: string;
  description: string;
  priceAed: number;
  currency: string;
  interval: string;
  features: string[];
  minUsers?: number;
  maxUsers: number | null;
  /** Maximum number of projects allowed. null = unlimited. */
  maxProjects?: number | null;
  storageMb: number;
  maxFileSizeMb: number;
  stripePriceEnv: string;
  popular?: boolean;
}

export const PLANS: PlanConfig[] = [
  {
    id: "free",
    name: "Free",
    description: "Retained access after trial expiry. Upgrade to unlock all features.",
    priceAed: 0,
    currency: "aed",
    interval: "month",
    features: [
      "1 user",
      "500 MB storage",
      "1 active project",
      "Documents & Dashboard only",
      "No AI credits",
    ],
    maxUsers: 1,
    maxProjects: 1,
    storageMb: 512,
    maxFileSizeMb: 100,
    stripePriceEnv: "",
  },
  {
    id: "trial",
    name: "Free Trial",
    description: "14-day full-feature trial. No credit card required.",
    priceAed: 0,
    currency: "aed",
    interval: "month",
    features: [
      "Up to 3 users",
      "2 GB storage",
      "1 active project",
      "50 MB max file size",
      "All core EDMS features",
      "1,000 AI credits included",
    ],
    maxUsers: 3,
    maxProjects: 1,
    storageMb: 2048,
    maxFileSizeMb: 50,
    stripePriceEnv: "",
  },
  {
    id: "starter",
    name: "Starter",
    description: "Essential document management for small teams",
    priceAed: 45,
    currency: "aed",
    interval: "month",
    features: [
      "Up to 10 users",
      "50 GB storage",
      "Basic transmittal management",
      "Standard support",
      "Document versioning",
      "AI features available via separate credit packs",
    ],
    maxUsers: 10,
    storageMb: 51200,
    maxFileSizeMb: 250,
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
      "250 GB storage",
      "Transmittal & register management",
      "Email support",
      "AI-assisted linking",
      "Rules engine",
      "AI features available via separate credit packs",
    ],
    minUsers: 3,
    maxUsers: 25,
    storageMb: 256000,
    maxFileSizeMb: 500,
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
      "1 TB storage",
      "All registers (ITR, NCR, NOC)",
      "Priority support",
      "Advanced analytics",
      "Custom workflows",
      "API access",
      "AI features available via separate credit packs",
    ],
    minUsers: 15,
    maxUsers: 100,
    storageMb: 1048576,
    maxFileSizeMb: 1024,
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
      "From 3 TB (custom)",
      "All features",
      "Dedicated support",
      "SLA guarantee",
      "On-premise option",
      "Custom integrations",
      "SSO / SAML",
      "AI features available via separate credit packs",
    ],
    maxUsers: null,
    storageMb: 1048576,
    maxFileSizeMb: 1024,
    stripePriceEnv: "STRIPE_PRICE_ENTERPRISE",
  },
];

export function getPlanById(planId: string): PlanConfig | null {
  return PLANS.find(p => p.id === planId) ?? null;
}

export function getPlanByTier(tier: string | null | undefined): PlanConfig | null {
  return PLANS.find(p => p.id === (tier ?? "free")) ?? null;
}

export type OrgModuleFlags = {
  dashboard: boolean;
  deliverables: boolean;
  registers: boolean;
  notifications: boolean;
  chat: boolean;
};

export function getDefaultModulesForPlan(planId: string): OrgModuleFlags {
  const map: Record<string, OrgModuleFlags> = {
    free:         { dashboard: true, deliverables: false, registers: false, notifications: true, chat: false },
    trial:        { dashboard: true, deliverables: true,  registers: true,  notifications: true, chat: true  },
    starter:      { dashboard: true, deliverables: true,  registers: true,  notifications: true, chat: false },
    basic:        { dashboard: true, deliverables: true,  registers: true,  notifications: true, chat: true  },
    professional: { dashboard: true, deliverables: true,  registers: true,  notifications: true, chat: true  },
    enterprise:   { dashboard: true, deliverables: true,  registers: true,  notifications: true, chat: true  },
  };
  return map[planId] ?? map.free;
}
