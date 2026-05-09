---
phase: 30
plan: "01"
subsystem: plans
tags: [monetization, database, stripe]
dependency_graph:
  requires: []
  provides: [plans-schema, tenant-subscriptions-schema, stripe-connections-schema]
  affects: [src/types/database.ts, supabase/migrations/, src/lib/]
tech_stack:
  added: []
  patterns: [database-migration, seed-data, nullable-override-pattern]
key_files:
  created:
    - supabase/migrations/029_plans_subscriptions.sql
    - src/lib/tenant-plan.ts
  modified:
    - src/types/database.ts
decisions:
  - "Created getTenantPlan() in src/lib/tenant-plan.ts as single source of truth for plan resolution"
  - "Used Supabase migration pattern consistent with migrations 024-028"
  - "Override pattern: NULL = use plan value, non-NULL = use override"
  - "Grandfathered all existing tenants to payments plan with override_notes marker"
---

# Phase 30: Schema + Planos Base — Summary

## One-liner

Database schema for subscription plan system with 3 base plans (menu/orders/payments) and getTenantPlan() helper

## Overview

Created foundational database schema for v2.0 Monetization (SEED-009 Phase A). Added 4 new tables, seeded 3 subscription plans, and created helper function for resolving effective tenant plans with override support.

## Tasks Completed

| Task | Name | Status | Files |
|------|------|--------|-------|
| 1 | Create Migration SQL File | ✅ Complete | supabase/migrations/029_plans_subscriptions.sql |
| 2 | Add TypeScript Types | ✅ Complete | src/types/database.ts |
| 3 | Create getTenantPlan() Helper | ✅ Complete | src/lib/tenant-plan.ts |
| 4 | Apply Migration | ⏸️ Pending | Requires Supabase CLI |

## What Was Built

### 1. Migration SQL (029_plans_subscriptions.sql)
- **plans** table: Lookup for subscription tiers with monthly_price, annual_price, transaction_fee_pct, features JSONB
- **tenant_subscriptions** table: Per-tenant subscription with override fields (override_monthly_price, override_annual_price, override_transaction_fee_pct)
- **stripe_connections** table: Per-tenant Stripe Connect account reference
- **processed_stripe_events** table: Webhook idempotency tracking
- RLS policies: plans readable by all authenticated; tenant_subscriptions/stripe_connections readable by owner and superadmin
- Indexes on tenant_id columns for efficient lookups

### 2. Seed Data: 3 Base Plans
| slug | name | monthly | annual | features |
|------|------|---------|--------|----------|
| menu | Digital Menu | $49 | $490 | digital-menu, qr-code, analytics |
| orders | Menu + Orders | $99 | $990 | digital-menu, orders, qr-code, analytics |
| payments | Menu + Payments | $179 | $1,790 | digital-menu, orders, payments, stripe-connect, analytics |

### 3. Grandfathering
All existing tenants get tenant_subscriptions entry with payments plan, billing_cycle=monthly, status=active, override_notes='grandfathered on launch'

### 4. TypeScript Types (database.ts)
- **Plan**: Interface for plans table row
- **EffectivePlan**: Resolved plan with all values populated (never mixed)
- **TenantSubscription**: Per-tenant subscription with overrides
- **StripeConnection**: Per-tenant Stripe Connect account
- **ProcessedStripeEvent**: Webhook idempotency

### 5. Helper Function (tenant-plan.ts)
- **getTenantPlan(tenantId)**: Resolves effective plan with override support
- **tenantHasFeature(tenantId, feature)**: Check if feature available
- **tenantHasPaidPlan(tenantId)**: Check if on paid plan

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None - all functionality implemented.

## Auth Gates

None - no authentication gates encountered.

## Verification

Migration file ready for deployment:
```bash
npx supabase db push
# or
npx supabase migration push
```

Verify seed data after deployment:
```sql
SELECT * FROM plans; -- should return 3 rows
SELECT * FROM tenant_subscriptions; -- should have entries for all existing tenants
```

## Metrics

- **Duration**: ~15 minutes
- **Files created**: 3
- **Files modified**: 1
- **Lines added**: ~465