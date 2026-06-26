# Registration Policies — B2B SaaS Strategy
> Source: `سياسات التسجيل في النظام.odt`  
> Date: ~2026-04 (Replit phase)

## Core Principle
Registration policy is not just a marketing decision — it is the first line of defense against abuse in a B2B EDMS with heavy storage and variable AI costs.

## Recommended Model: Hybrid Gated Registration

| Model | Used by | Risks |
|-------|---------|-------|
| Open Self-Signup | Consumer/light B2B (Notion, Slack) | Abuse, spam, uncontrolled costs |
| Invite-Only | Exclusive Enterprise (Linear early, Superhuman) | Slow growth, sales friction |
| **Hybrid Gated** ← Recommended | Heavy-resource B2B (Figma, Linear, Vercel) | Requires thoughtful design |

## Why Hybrid is Correct for EDMS

- Resources per user are high (storage, AI, bandwidth)
- Serious clients are few but high-value (engineering companies)
- Abuse vectors are clear: spam accounts uploading garbage, AI farming, tenant-cluttering
- B2B decision is not impulse: serious clients are willing to have a short sales conversation

## Recommended Structure: Two-Track Registration

**Track A — Free Trial (Self-Signup):**
- Time-limited and resource-limited
- For product evaluation only

**Track B — Paid Onboarding (Invite/Sales):**
- For paying customers with full permissions

## Recommended Trial Limits

| Resource | Limit | Rationale |
|----------|-------|-----------|
| Duration | 14 days | Enough for evaluation, creates urgency |
| Users | 3 | Proves team functionality without opening full org |
| Storage | 2 GB | Enough for 20-30 test files, not enough for real project |
| Max file size | 50 MB | Enough for PDFs and small CAD |
| AI credits | Limited | Allows feature evaluation |

## Current Implementation Status

The current system has `registrationEnabled` flag in `system_settings` table. When enabled, anyone with a valid email can register. This is the **Open Self-Signup** model — considered the least safe option per this document. The recommended Hybrid model is not yet implemented.
