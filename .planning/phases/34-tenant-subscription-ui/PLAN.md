---
phase: 34
plan: 34
type: auto
autonomous: true
wave: 1
depends_on: []
requirements: [MON-02, MON-04]
---

# Phase 34 Plan: Tenant Subscription UI

## Objective

Build the tenant-facing subscription management panel for xmartmenu's v2.0 Monetization (SEED-009). The subscription page shows current plan details, billing cycle toggle, feature list, Stripe connection status (for Payments plan), and upgrade prompts.

## Context

This plan implements the UI layer for tenant subscription management. It connects to existing infrastructure:
- `getTenantPlan()` from Phase 30 returns resolved plan with overrides
- `isStripeEnabled()` from Phase 32 checks Stripe Connect status
- Existing `tenant_subscriptions` and `plans` tables store data
- AdminSidebar needs Subscription nav item

**Key decisions from context:**
- Subscription page at `/settings/subscription` (alongside other admin settings)
- Tenant cannot self-change plans — show "Contact support" CTA
- Billing cycle toggle updates DB only (no Stripe integration yet)
- Handle null subscription gracefully with "No active subscription" state

## Tasks

### Task 1: Add Subscription nav item to AdminSidebar

**Type:** auto  
**Files:** `src/components/admin/AdminSidebar.tsx`  
**Verification:** New nav item appears in Admin Panel collapsible section

**Implementation:**
- Add `{ href: '/settings/subscription', label: 'Subscription', icon: '💳' }` to `adminPanelItems` array
- Should appear between Store and Branding
- Visible for store-admin and store-staff roles (staff can view but not modify)

### Task 2: Create tenant subscription API route

**Type:** auto  
**Files:** `src/app/api/tenant/subscription/route.ts`  
**Verification:** GET returns subscription+plan+features, PATCH updates billing_cycle

**Implementation:**
- GET /api/tenant/subscription
  - Use getEffectiveTenant() to get tenantId
  - Fetch subscription from tenant_subscriptions
  - Use getTenantPlan() to get EffectivePlan
  - Use isStripeEnabled() to check Stripe status
  - Return: { subscription, plan, stripeEnabled, stripeAccountId }
  
- PATCH /api/tenant/subscription
  - Accept { billing_cycle: 'monthly' | 'annual' }
  - Update tenant_subscriptions.billing_cycle
  - Return { success: true, subscription }

### Task 3: Create subscription page server component

**Type:** auto  
**Files:** `src/app/(admin)/settings/subscription/page.tsx`  
**Verification:** Page renders and passes data to client component

**Implementation:**
- Server component using getEffectiveTenant()
- Fetch subscription, plan data, Stripe status
- Pass to SubscriptionClient component
- Handle null plan case (no active subscription)

### Task 4: Create SubscriptionClient component

**Type:** auto  
**Files:** `src/app/(admin)/settings/subscription/SubscriptionClient.tsx`  
**Verification:** Full interactive UI with current plan, features, Stripe status, upgrade CTA

**Implementation:**
- Receive plan, stripeEnabled, tenantId from parent
- Current Plan Card:
  - Plan name + badge
  - Billing cycle toggle (monthly/annual)
  - Monthly/annual price display
  - Transaction fee % (if Payments plan)
  - Next billing date placeholder
  
- Features List:
  - Show all features from all plans
  - Checkmark for included features
  - Locked/grey for excluded features
  - Group by: "Your Plan" vs "Upgrade to Unlock"
  
- Stripe Connection Status:
  - If Payments plan: show connected/not connected
  - Link to /settings/store for Stripe management
  - CTA to connect if not connected
  
- Upgrade Section:
  - If not on Payments plan: show upgrade prompt
  - Show what features they'd gain
  - "Contact support" CTA (not self-serve)
  
- Handle no subscription state:
  - Show "No active subscription" message
  - Prompt to contact support

## Success Criteria

- [ ] AdminSidebar shows "Subscription" in Admin Panel section
- [ ] GET /api/tenant/subscription returns plan, features, Stripe status
- [ ] PATCH /api/tenant/subscription updates billing_cycle
- [ ] /settings/subscription page renders without errors
- [ ] SubscriptionClient shows current plan with features
- [ ] Billing cycle toggle works and persists to DB
- [ ] Stripe connection status shows for Payments plan
- [ ] Upgrade CTA shows for non-Payments plans
- [ ] Null subscription state handled gracefully
- [ ] UI matches existing admin patterns (Tailwind, zinc palette)

## Output Specification

Files to create:
- `src/app/api/tenant/subscription/route.ts` (API route)
- `src/app/(admin)/settings/subscription/page.tsx` (server page)
- `src/app/(admin)/settings/subscription/SubscriptionClient.tsx` (client component)

Files to modify:
- `src/components/admin/AdminSidebar.tsx` (add nav item)