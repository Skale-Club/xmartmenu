---
phase: 31
plan: "01"
name: Superadmin Plan Management
status: discussion
created: 2026-05-09
---

# Phase 31 Context: Superadmin Plan Management

## Overview

Phase 31 is the second phase of SEED-009 (v2.0 Monetization). It implements the superadmin-facing UI for managing subscription plans and tenant subscription overrides.

## What Was Built (Phase 30)

- **Database Schema**: `plans`, `tenant_subscriptions`, `stripe_connections`, `processed_stripe_events` tables
- **Seed Data**: 3 plans (menu $49, orders $99, payments $179)
- **Helper**: `getTenantPlan(tenantId)` in `src/lib/tenant-plan.ts`
- **Types**: `Plan`, `EffectivePlan`, `TenantSubscription`, `StripeConnection`

## What Needs to Be Built (Phase 31)

### 1. `/superadmin/plans` — Plan Management Page
- List all plans with inline editing
- Editable fields: name, monthly_price, annual_price, transaction_fee_pct, features, is_active
- Any field editabile without deploy
- Sort order control

### 2. `/superadmin/tenants/[id]` — Subscription Tab
- Display current plan with effective pricing (includes overrides)
- Billing cycle selector (monthly/annual)
- Override fields:
  - override_monthly_price
  - override_annual_price
  - override_transaction_fee_pct
  - override_notes
- "Save Override" button
- Visual indicator if plan is grandfathered

### 3. Tenant List Enhancement
- Add plan column to tenants table
- Show current plan name/slug for each tenant

## Existing Patterns

### Superadmin Routes
- `/superadmin/tenants` — Tenant list with search
- `/superadmin/tenants/[id]` — Tenant detail with tabs (Staff, Menus)
- Uses `createServiceClient()` for admin data access

### Settings Pattern (StoreClient)
- Section-based form layout with borders
- Inline form state with useState
- Supabase upsert with onConflict
- Success/error state handling

### Plan Types (database.ts)
```typescript
interface Plan {
  id, name, slug, description, monthly_price, 
  annual_price, transaction_fee_pct, features, 
  is_active, sort_order
}

interface EffectivePlan {
  // ... plus billing_cycle, status, is_grandfathered
}
```

### Override Pattern
- NULL value = use plan's base value
- Non-NULL value = override applied
- `getTenantPlan()` handles resolution automatically

## Key Files to Create/Modify

1. **New**: `src/app/(superadmin)/plans/page.tsx` — Plan list page
2. **New**: `src/app/(superadmin)/plans/PlansClient.tsx` — Plan CRUD UI
3. **Modify**: `src/app/(superadmin)/tenants/[id]/TenantDetailClient.tsx` — Add subscription tab
4. **Modify**: `src/app/(superadmin)/tenants/TenantsClient.tsx` — Add plan column

## API Endpoints Needed

- `GET /api/superadmin/plans` — List all plans
- `PUT /api/superadmin/plans/[id]` — Update plan
- `GET /api/superadmin/tenants/[id]/subscription` — Get tenant subscription
- `PUT /api/superadmin/tenants/[id]/subscription` — Update subscription/override

## Requirements from SEED-009

- MON-01: Plans table with monthly/annual pricing, transaction fee
- MON-02: Tenant subscriptions with billing cycle and override support
- All prices read from DB, zero hardcoding
- Override fields are nullable — NULL = use base, value = override