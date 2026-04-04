export interface PlanConfig {
  id: string;
  name: string;
  description: string;
  priceAed: number;
  currency: string;
  interval: string;
  features: string[];
  maxUsers: number | null;
  storageMb: number;
  stripePriceEnv: string;
  popular?: boolean;
}

export const PLANS: PlanConfig[] = [
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
    starter:      { dashboard: true, deliverables: true,  registers: true,  notifications: true, chat: false },
    basic:        { dashboard: true, deliverables: true,  registers: true,  notifications: true, chat: true  },
    professional: { dashboard: true, deliverables: true,  registers: true,  notifications: true, chat: true  },
    enterprise:   { dashboard: true, deliverables: true,  registers: true,  notifications: true, chat: true  },
  };
  return map[planId] ?? map.free;
}
