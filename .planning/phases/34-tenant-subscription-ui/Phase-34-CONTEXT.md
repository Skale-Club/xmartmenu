---
phase: 34
plan: 34
subsystem: billing
tags: [subscription, billing, plans, monetização, tenant-ui]
dependency_graph:
  requires:
    - Phase 30 (Schema + Planos Base — plans/tenant_subscriptions tables, getTenantPlan)
    - Phase 31 (Superadmin Plan Management — plans CRUD, tenant plan assignment)
    - Phase 32 (Stripe Connect OAuth — connect/disconnect flow, tenant Stripe UI)
    - Phase 33 (Payment Intent + Webhook — checkout flow, webhook handlers)
  provides:
    - MON-01 (Plans table with pricing, transaction fee)
    - MON-02 (Tenant subscriptions with billing cycle and override support)
    - MON-04 (Feature gating based on plan type)
  affects:
    - src/components/admin/AdminSidebar.tsx (add Subscription nav item)
    - src/app/(admin)/settings/subscription/ (new subscription page)
    - src/app/api/tenant/subscription/route.ts (new API for tenant subscription management)
tech_stack:
  added:
    - None (existing packages reused)
  patterns:
    - Tenant-facing plan comparison card UI
    - Feature gating display (shows what features tenant has/lacks)
    - Plan upgrade flow (if Stripe integration exists, could trigger subscription)
    - Billing cycle toggle (monthly/annual)
    - Stripe Connect status integration from existing StoreClient
key_files:
  created:
    - src/app/(admin)/settings/subscription/page.tsx (subscription page)
    - src/app/(admin)/settings/subscription/SubscriptionClient.tsx (client component)
    - src/app/api/tenant/subscription/route.ts (API for tenant subscription)
    - src/components/admin/AdminSidebar.tsx (add subscription nav item)
  modified:
    - src/lib/tenant-plan.ts (possibly extend for plan comparison)
    - src/types/database.ts (if needed for new types)
decisions:
  - "Subscription page lives at /settings/subscription (alongside Store, Branding, QR Code, Staff, Password)"
  - "Superadmin already owns plan assignment — tenant cannot self-select plans arbitrarily"
  - "Subscription page shows: current plan details, features list, Stripe connection status, upgrade prompt"
  - "Tenant can only toggle billing_cycle (monthly/annual) — plan changes require superadmin"
  - "If tenant not on payments plan, show upgrade CTA pointing to available plans"
  - "Stripe Connect status shown inline — link to /settings/store for connect/disconnect"
---

# Phase 34 Context: Tenant Subscription UI

## Objective

Build the tenant-facing subscription management panel for xmartmenu's v2.0 Monetization (SEED-009).

**From ROADMAP.md:** "Tenant Subscription UI — Tenant-facing subscription panel, upgrade flow"

**From SEED-009 requirements:**
- MON-01: Plans table with monthly/annual pricing, transaction fee
- MON-02: Tenant subscriptions with billing cycle and override support
- MON-04: Feature gating based on plan type

## Prior Art (Phases 30–33)

### What's Already Built

| Component | Location | Status |
|---|---|---|
| Plans table | Migration 029 | ✅ 3 seeded plans (menu/orders/payments) |
| tenant_subscriptions table | Migration 029 | ✅ Stores plan_id, billing_cycle, overrides |
| stripe_connections table | Migration 029 | ✅ is_active for connected tenants |
| processed_stripe_events | Migration 029 | ✅ Webhook idempotency |
| getTenantPlan() | `src/lib/tenant-plan.ts` | ✅ Returns EffectivePlan with all resolved values |
| Superadmin Plan UI | `src/app/(superadmin)/plans/` | ✅ CRUD for plans |
| Superadmin Tenant Subscription | `src/app/(superadmin)/tenants/[id]/TenantDetailClient.tsx` | ✅ Subscription tab with overrides |
| Stripe Connect OAuth | `src/app/api/stripe/connect/` | ✅ connect/callback/disconnect routes |
| Tenant Stripe UI | `src/app/(admin)/settings/store/StoreClient.tsx` | ✅ Connect/disconnect button |
| PaymentIntent | `src/app/api/stripe/payment-intents/route.ts` | ✅ Phase 33 |
| Webhook handler | `src/app/api/stripe/webhooks/route.ts` | ✅ Phase 33 |

### Plan Features

```
menu plan:       ["digital-menu","qr-code","analytics"]
orders plan:     ["digital-menu","orders","qr-code","analytics"]
payments plan:   ["digital-menu","orders","payments","stripe-connect","analytics"]
```

### Seeded Plans (Migration 029)

| Plan | Monthly | Annual | Transaction Fee |
|---|---|---|---|
| Menu | $29 | $290 | N/A |
| Orders | $59 | $590 | N/A |
| Payments | $99 | $990 | 0.50% |

### Existing Admin Navigation

`AdminSidebar.tsx` currently has:
- Dashboard, Menus, Categories, Products, Orders (main)
- Store, Branding, QR Code, Password, Staff (admin panel collapsible)

**Missing:** Subscription nav item

## What Phase 34 Needs to Build

### 1. Tenant Subscription API Route

**Path:** `src/app/api/tenant/subscription/route.ts`

**Purpose:** Tenant-facing API for subscription management (read current subscription, update billing cycle).

**Endpoints:**

```
GET /api/tenant/subscription
Authorization: session
Response: { subscription, plan, features }

PATCH /api/tenant/subscription
Authorization: session
Body: { billing_cycle: 'monthly' | 'annual' }
Response: { success: true, subscription }
```

**Key points:**
- Tenant reads their own subscription (derived from session tenant_id)
- Tenant can only update `billing_cycle` — plan changes require superadmin
- Returns enriched data: subscription + resolved plan + feature list

### 2. Subscription Page

**Path:** `src/app/(admin)/settings/subscription/page.tsx`

**Purpose:** Server component that fetches tenant's subscription and renders the page.

```tsx
import { createClient } from '@/lib/supabase/server'
import { getTenantPlan } from '@/lib/tenant-plan'
import { isStripeEnabled } from '@/lib/stripe'
import SubscriptionClient from './SubscriptionClient'

export default async function SubscriptionPage() {
  const supabase = await createClient()
  
  // Get session → tenant_id
  const { data: { user } } = await supabase.auth.getUser()
  // ... fetch tenant_id from profiles

  // Get subscription + plan data
  const plan = await getTenantPlan(tenantId)
  const stripeEnabled = await isStripeEnabled(tenantId)

  return (
    <SubscriptionClient
      plan={plan}
      stripeEnabled={stripeEnabled}
      tenantId={tenantId}
    />
  )
}
```

### 3. SubscriptionClient Component

**Path:** `src/app/(admin)/settings/subscription/SubscriptionClient.tsx`

**Purpose:** Client component with interactive subscription UI.

**Features to implement:**

1. **Current Plan Card** — Shows:
   - Plan name + badge (Menu/Orders/Payments)
   - Billing cycle (monthly/annual) with toggle
   - Monthly/annual price with savings highlight
   - Effective price (considering overrides)
   - Next billing date (if applicable)

2. **Features List** — Shows:
   - All features tenant currently has (from plan.features)
   - Visual checkmarks for included features
   - Locked/greyed features not in current plan

3. **Stripe Connection Status** — Shows:
   - If on Payments plan: Stripe Connect status (connected/not connected)
   - Link to `/settings/store` for Stripe management
   - "Connect Stripe" CTA if not connected

4. **Upgrade Section** — Shows:
   - If on Menu or Orders plan: upgrade prompt to Payments
   - Show what they'd gain (payments feature, Stripe Connect)
   - "Contact support" or "Request upgrade" CTA
   - (Note: actual self-serve upgrade deferred — tenant cannot arbitrarily change plans)

5. **Transaction Fee Info** — Shows:
   - Current transaction fee % (if on Payments plan)
   - How fees are calculated
   - Historical transaction summary (optional, could be deferred)

**Visual design:** Match existing admin patterns (section cards, Tailwind, zinc palette)

### 4. AdminSidebar Navigation Update

**Path:** `src/components/admin/AdminSidebar.tsx`

Add subscription nav item to adminPanelItems:
```tsx
const adminPanelItems = [
  { href: '/settings/store', label: 'Store', icon: '🏪' },
  { href: '/settings/subscription', label: 'Subscription', icon: '💳' },  // NEW
  { href: '/settings/branding', label: 'Branding', icon: '🎨' },
  { href: '/settings/qrcode', label: 'QR Code', icon: '📱' },
  { href: '/settings/password', label: 'Change Password', icon: '🔑' },
  { href: '/settings/staff', label: 'Staff', icon: '👥' },
]
```

**Decision needed:** Should "Subscription" appear for all roles or only store-admin? Staff should probably see it (they care about plan features), but cannot modify it.

### 5. Type Extensions

**Path:** `src/types/database.ts`

May need to add:
- `EffectivePlan` type already exists in Phase 30
- May need `SubscriptionWithPlan` helper type for frontend

## Open Questions / Decisions Needed

### Q1: Can tenants self-upgrade plans?

**Context:** Superadmin currently assigns plans. Tenant cannot arbitrarily change plans.

**Options:**
- **No self-serve:** Tenant sees upgrade CTA → "Contact support" → superadmin reassigns
- **Yes self-serve:** Tenant can select any active plan → triggers Stripe subscription creation

**Recommendation for planning:** Start with "Contact support" flow. True self-serve subscription billing requires Stripe Customer Portal + Subscription API + webhook lifecycle — out of scope for Phase 34. Phase 34 is UI only; billing automation is Phase 35+.

### Q2: What to show when tenant has no subscription?

**Context:** Legacy tenants may exist without tenant_subscriptions record (grandfathered).

**Options:**
- Show "Legacy account — contact support for plan details"
- Show default Menu plan features
- Show upgrade prompt

**Recommendation for planning:** `getTenantPlan()` returns `null` for no subscription. Handle null gracefully with a "No active subscription" state that prompts contact with superadmin.

### Q3: Billing cycle toggle — what does it affect?

**Context:** Tenant can toggle monthly ↔ annual. What happens?

**Options:**
- Toggle is cosmetic display only (not sent to Stripe yet)
- Toggle triggers subscription change via Stripe API
- Toggle just updates tenant_subscriptions.billing_cycle

**Recommendation for planning:** Toggle updates `billing_cycle` in tenant_subscriptions (simple for now). Actual Stripe subscription lifecycle deferred to Phase 35.

### Q4: Transaction fee display — where does the data come from?

**Context:** Payments plan has `transaction_fee_pct`. Tenant wants to know their fee.

**Source:** `getTenantPlan()` returns `transaction_fee_pct` with override support.

**Display:** Show effective fee % with "(plan default)" or "(custom)" indicator.

## Implementation Order (recommended)

1. **AdminSidebar update** — Add Subscription nav item
2. **Subscription API route** — GET + PATCH for tenant subscription
3. **Subscription page** — Server component with data fetching
4. **SubscriptionClient** — Full interactive UI
5. **Edge case handling** — No subscription, Stripe not enabled, etc.

## Dependencies

| Dependency | Status | Notes |
|---|---|---|
| `getTenantPlan()` | ✅ Exists | Phase 30 |
| `isStripeEnabled()` | ✅ Exists | Phase 32 |
| `tenant_subscriptions` table | ✅ Exists | Migration 029 |
| `plans` table | ✅ Exists | Migration 029 |
| Stripe Connect routes | ✅ Exists | Phase 32 |
| Superadmin subscription UI | ✅ Exists | Phase 31 |

## References

- Superadmin subscription tab: `src/app/(superadmin)/tenants/[id]/TenantDetailClient.tsx` (subscription tab, lines 583+)
- Existing StoreClient Stripe section: `src/app/(admin)/settings/store/StoreClient.tsx` (Stripe Connect section, lines 289-331)
- Plan comparison UI pattern: `src/app/(superadmin)/plans/PlansClient.tsx`
- Billing cycle pattern: tenant_subscriptions.billing_cycle field

## Notes

- Phase 34 is **UI only** — no Stripe subscription API integration yet
- Actual subscription billing (Stripe Customer Portal, invoice lifecycle) is Phase 35+
- Tenant subscription page is informational + billing cycle toggle for now
- Upgrade flow is "contact support" CTA, not self-serve
