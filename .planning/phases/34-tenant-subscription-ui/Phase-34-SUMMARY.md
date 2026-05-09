---
phase: 34
plan: 34
subsystem: admin-ui
tags: [monetization, subscription, billing, stripe]
dependency_graph:
  requires:
    - Phase 30 (Schema + Planos Base)
    - Phase 32 (Stripe Connect OAuth)
  provides:
    - /settings/subscription page
    - /api/tenant/subscription route
  affects:
    - AdminSidebar navigation
tech_stack:
  added:
    - Tenant subscription API route
    - Subscription page with plan display
    - Billing cycle toggle (monthly/annual)
    - Stripe connection status
    - Features comparison list
key_files:
  created:
    - src/app/api/tenant/subscription/route.ts
    - src/app/(admin)/settings/subscription/page.tsx
    - src/app/(admin)/settings/subscription/SubscriptionClient.tsx
  modified:
    - src/components/admin/AdminSidebar.tsx
decisions:
  - Subscription page at /settings/subscription (alongside other admin settings)
  - Tenant cannot self-change plans - show "Contact support" CTA
  - Billing cycle toggle updates DB only (no Stripe integration yet)
  - Handle null subscription gracefully with "No active subscription" state
---

# Phase 34 Plan: Tenant Subscription UI Summary

One-liner: **Tenant subscription management panel showing current plan, billing cycle, features, and Stripe connection status**

## Objective

Build the tenant-facing subscription management panel for xmartmenu's v2.0 Monetization (SEED-009). The subscription page shows current plan details, billing cycle toggle, feature list, Stripe connection status (for Payments plan), and upgrade prompts.

## Completed Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Add Subscription nav item to AdminSidebar | 63bc086 |
| 2 | Create tenant subscription API route | d7cbc11 |
| 3 | Create subscription page server component | 508347e |
| 4 | Create SubscriptionClient component | 508347e |

## Implementation Details

### Task 1: AdminSidebar Nav Item
- Added `{ href: '/settings/subscription', label: 'Subscription', icon: '💳' }` to `adminPanelItems` array
- Appears between Store and Branding
- Visible for store-admin role (not staff)

### Task 2: Tenant Subscription API
- **GET /api/tenant/subscription**: Returns subscription, plan, features, stripeEnabled, stripeAccountId
- **PATCH /api/tenant/subscription**: Updates billing_cycle (monthly/annual)
- Uses existing helpers: getEffectiveTenant(), getTenantPlan(), isStripeEnabled()

### Task 3: Server Page Component
- Server component using getEffectiveTenant() to get tenant context
- Fetches subscription, plan data, Stripe status
- Passes to SubscriptionClient component
- Handles null plan case (no active subscription)

### Task 4: SubscriptionClient Component
- **Current Plan Card**: Plan name, badge, billing cycle toggle, price display, transaction fee %
- **Features List**: Shows all features grouped by "Your Plan" vs "Upgrade to Unlock"
- **Stripe Connection Status**: For Payments plan - shows connected/not connected with CTA
- **Upgrade Section**: For non-Payments plans - shows upgrade prompt with "Contact support" CTA
- **No Subscription State**: Shows "No active subscription" with contact support prompt

## Success Criteria Status

- [x] AdminSidebar shows "Subscription" in Admin Panel section
- [x] GET /api/tenant/subscription returns plan, features, Stripe status
- [x] PATCH /api/tenant/subscription updates billing_cycle
- [x] /settings/subscription page renders without errors
- [x] SubscriptionClient shows current plan with features
- [x] Billing cycle toggle works and persists to DB
- [x] Stripe connection status shows for Payments plan
- [x] Upgrade CTA shows for non-Payments plans
- [x] Null subscription state handled gracefully
- [x] UI matches existing admin patterns (Tailwind, zinc palette)

## Metrics

- **Duration**: ~8 min
- **Tasks**: 4 tasks completed
- **Files**: 4 files created, 1 file modified