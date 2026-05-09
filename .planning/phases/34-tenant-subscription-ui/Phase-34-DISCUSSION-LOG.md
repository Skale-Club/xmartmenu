---
phase: 34
plan: 34
started: 2026-05-09
status: discussed
next_action: plan-phase 34
---

# Phase 34 Discussion Log

## Date: 2026-05-09

## Context Discovery

**Milestone:** v2.0 Monetization (SEED-009) — Phase 34 of 5 phases
**Previous phases completed:** 30 (Schema), 31 (Superadmin Plan UI), 32 (Stripe Connect OAuth), 33 (Payment Intent + Webhook)
**Current state:** Phase 33 complete (7/8 tasks), Phase 34 directory created, context documented. Ready to plan.

### What Phase 34 Covers

From ROADMAP.md: "Tenant Subscription UI — Tenant-facing subscription panel, upgrade flow"

From SEED-009 requirements:
- MON-01: Plans table with monthly/annual pricing, transaction fee
- MON-02: Tenant subscriptions with billing cycle and override support
- MON-04: Feature gating based on plan type

### Available Infrastructure

- ✅ Plans table with seeded plans (menu/orders/payments)
- ✅ tenant_subscriptions table with billing_cycle, override columns
- ✅ `getTenantPlan()` returns EffectivePlan with resolved prices/fees
- ✅ Superadmin plan management UI (Phase 31)
- ✅ Superadmin subscription overrides UI (Phase 31)
- ✅ Stripe Connect OAuth flow (Phase 32)
- ✅ Tenant Stripe Connect UI in Store Settings (Phase 32)
- ✅ Payment webhook handlers (Phase 33)
- ✅ 3 seeded plans with features arrays

### Missing Infrastructure

- ❌ Tenant-facing subscription management page
- ❌ Subscription nav item in AdminSidebar
- ❌ Tenant API for subscription (GET/PATCH billing_cycle)
- ❌ Stripe Customer Portal integration (deferred to Phase 35+)
- ❌ Self-serve plan upgrade/downgrade (deferred to Phase 35+)

## Key Architectural Decisions Discussed

### 1. Subscription Page Location: /settings/subscription

**Decision:** Subscription page lives alongside other settings pages (Store, Branding, QR Code, Staff, Password).

**Rationale:**
- Consistent with existing admin settings pattern
- Easy to find alongside Stripe Connect settings in Store
- Billing/subscription is a settings concern, not a main nav item

**Implementation:** Add to `adminPanelItems` in `AdminSidebar.tsx`:
```tsx
{ href: '/settings/subscription', label: 'Subscription', icon: '💳' }
```

### 2. Tenant Cannot Self-Change Plans

**Decision:** Tenant subscription page shows current plan details and upgrade prompts, but tenant cannot arbitrarily select different plans. Plan changes require superadmin intervention.

**Rationale:**
- Superadmin owns plan assignment (Phase 31)
- True self-serve plan changes require Stripe Customer Portal + subscription lifecycle
- Phase 34 is UI/awareness only — billing automation is Phase 35+

**Implementation:**
- Show "Contact support" or "Request upgrade" CTA
- Show what features they'd gain with higher plan
- Stripe Connect status shown inline with link to Store settings

### 3. Billing Cycle Toggle: Database Only (for now)

**Decision:** Tenant can toggle billing_cycle (monthly ↔ annual) and it updates `tenant_subscriptions.billing_cycle`, but does NOT trigger Stripe subscription changes yet.

**Rationale:**
- Stripe subscription lifecycle (invoice creation, proration) requires Phase 35
- Simple DB update unblocks Phase 34 without Stripe integration
- Billing cycle preference stored for future subscription creation

**Implementation:**
- `PATCH /api/tenant/subscription` with `{ billing_cycle }`
- Updates `tenant_subscriptions.billing_cycle` directly
- Returns updated subscription for UI refresh

### 4. Handle Null Subscription Gracefully

**Decision:** If tenant has no subscription record (legacy tenants), show "No active subscription" state with prompt to contact support.

**Rationale:**
- `getTenantPlan()` returns `null` for no subscription
- `null` is a valid state, not an error
- All existing tenants were grandfathered with override_notes in Phase 30

**Implementation:**
```tsx
if (!plan) {
  return (
    <div>
      <p>No active subscription</p>
      <p>Contact support to set up your subscription</p>
    </div>
  )
}
```

### 5. Feature Gating Display: Show What's Missing

**Decision:** Subscription page shows both:
1. Features tenant currently has (with checkmarks)
2. Features they don't have (greyed/locked)

**Rationale:**
- Helps tenant understand value of current plan
- Clear upgrade motivation
- Feature list comes from `plan.features` array

**Implementation:**
- Compare current plan features against all available features
- Show "included" vs "upgrade to unlock" styling

### 6. Stripe Connect Status Shown Inline

**Decision:** Payments plan tenants see Stripe Connect status on subscription page (not just Store page).

**Rationale:**
- Payments plan requires Stripe Connect for payment processing
- Subscriber should see both their plan AND their payment readiness
- Link to `/settings/store` for full Stripe management

**Implementation:**
- If plan includes `stripe-connect` feature, show Stripe status section
- "Connected" / "Not connected" with CTA to connect

## Open Questions Resolved

### Q1: Can tenants self-upgrade plans?

**Resolved:** No self-serve for Phase 34. Show "Contact support" CTA. Self-serve subscription billing deferred to Phase 35+.

### Q2: What to show when tenant has no subscription?

**Resolved:** Handle null from `getTenantPlan()` with "No active subscription" state, prompt contact with superadmin.

### Q3: Billing cycle toggle — what does it affect?

**Resolved:** Updates `tenant_subscriptions.billing_cycle` in DB only. No Stripe integration yet.

### Q4: Transaction fee display — where does the data come from?

**Resolved:** `EffectivePlan.transaction_fee_pct` from `getTenantPlan()`. Show with "(plan default)" or "(custom)" label.

## Decisions Made (locked for planning)

1. **Subscription page at /settings/subscription** — alongside other admin settings
2. **Tenant cannot self-change plans** — show upgrade CTA, contact support flow
3. **Billing cycle toggle** — updates DB only, no Stripe subscription yet
4. **Handle null subscription gracefully** — "contact support" state
5. **Show feature gaps** — display both included and missing features
6. **Stripe status shown inline** — payments plan shows Connect status with link to Store

## Component Architecture

```
/settings/subscription
├── page.tsx              (server, fetches subscription + plan)
│   └── SubscriptionClient.tsx  (client, interactive UI)
│       ├── CurrentPlanCard     (plan details, price, billing cycle)
│       ├── FeaturesList        (included + locked features)
│       ├── StripeStatusSection (if payments plan)
│       └── UpgradeSection      (if not on payments plan)
```

## API Design

### GET /api/tenant/subscription

```typescript
// Response
{
  subscription: TenantSubscription | null,
  plan: EffectivePlan | null,
  stripeEnabled: boolean,
  stripeAccountId: string | null
}
```

### PATCH /api/tenant/subscription

```typescript
// Request
{ billing_cycle: 'monthly' | 'annual' }

// Response
{ success: true, subscription: TenantSubscription }
```

## Dependencies for Execution

| Dependency | Status | Notes |
|---|---|---|
| `getTenantPlan()` | ✅ Exists | Phase 30 |
| `isStripeEnabled()` | ✅ Exists | Phase 32 |
| `tenant_subscriptions` table | ✅ Exists | Migration 029 |
| `plans` table | ✅ Exists | Migration 029 |
| Superadmin subscription UI | ✅ Exists | Phase 31 |
| AdminSidebar | ✅ Exists | Phase 0+ |

## Next Step

Run `plan-phase 34` to create the plan file with task breakdown.

## Notes

- Phase 34 is **UI + billing_cycle preference** — not full subscription billing
- Stripe Customer Portal + subscription lifecycle: Phase 35+
- Tenant subscription page is informational for Phase 34
- Upgrade flow is "contact support" CTA, not self-serve
- Phase 33 Task 8 (Stripe test keys) still pending — Phase 34 doesn't depend on it
