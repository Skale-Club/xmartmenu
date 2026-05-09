---
phase: 30
plan: 01
subsystem: plans
tags: [monetization, database, stripe]
dependency_graph:
  requires: []
  provides: [plans-schema, tenant-subscriptions-schema, stripe-connections-schema]
  affects: [src/types/database.ts, supabase/migrations/, src/lib/]
phase_started: 2026-05-09
milestone: v2.0 Monetization
seed: SEED-009 (Phase A scope)
tech_stack:
  added: []
  patterns: [database-migration, seed-data, nullable-override-pattern]
key_files:
  created:
    - supabase/migrations/029_plans_subscriptions.sql
  modified:
    - src/types/database.ts
    - src/lib/tenant-plan.ts (new helper)
---

# Phase 30: Schema + Planos Base — Context

## Phase Objective

Create the foundational database schema for the subscription plan system and seed the three base plans. This is Phase A of SEED-009 (Plans, Pricing & Stripe Connect Monetization).

**What this phase delivers:**
- Migration: 4 new tables (`plans`, `tenant_subscriptions`, `stripe_connections`, `processed_stripe_events`)
- Seed: 3 base plans with correct prices and features
- Migration: All existing tenants grandfathered into `payments` plan
- Types: `Plan`, `TenantSubscription`, `StripeConnection`, `ProcessedStripeEvent` in `database.ts`
- Helper: `getTenantPlan(tenantId)` that resolves override → base

**What this phase does NOT deliver:**
- No superadmin UI (Phase 31)
- No Stripe OAuth flow (Phase 32)
- No payment processing (Phase 33)
- No tenant subscription UI (Phase 34)

## Source: SEED-009 Phase A

### Tables to create

**plans** — lookup table for subscription tiers
```sql
CREATE TABLE plans (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                     TEXT NOT NULL,                -- "Digital Menu"
  slug                     TEXT NOT NULL UNIQUE,         -- "menu" | "orders" | "payments"
  description              TEXT,
  monthly_price            NUMERIC(10,2) NOT NULL,       -- 49.00
  annual_price             NUMERIC(10,2) NOT NULL,       -- 490.00
  transaction_fee_pct      NUMERIC(5,4) DEFAULT 0,       -- 0.0050 = 0.5%
  features                 JSONB NOT NULL DEFAULT '[]',  -- ["orders","payments","analytics"]
  is_active                BOOLEAN NOT NULL DEFAULT true,
  sort_order               INT NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ DEFAULT now(),
  updated_at               TIMESTAMPTZ DEFAULT now()
);
```

**tenant_subscriptions** — per-tenant subscription with override support
```sql
CREATE TABLE tenant_subscriptions (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id                       UUID NOT NULL REFERENCES plans(id),
  billing_cycle                 TEXT NOT NULL CHECK (billing_cycle IN ('monthly','annual')),
  status                        TEXT NOT NULL DEFAULT 'active'
                                  CHECK (status IN ('active','cancelled','trial','past_due')),
  -- Override: NULL = use plan value; value = custom price
  override_monthly_price        NUMERIC(10,2),
  override_annual_price         NUMERIC(10,2),
  override_transaction_fee_pct  NUMERIC(5,4),
  override_notes                TEXT,  -- "6-month deal, close at Masa's 2026-05-08"
  -- Stripe (for payments plan)
  stripe_customer_id            TEXT,
  stripe_subscription_id        TEXT,
  current_period_start          TIMESTAMPTZ,
  current_period_end            TIMESTAMPTZ,
  created_at                    TIMESTAMPTZ DEFAULT now(),
  updated_at                    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id)             -- one active subscription per tenant
);
```

**stripe_connections** — per-tenant Stripe Connect account reference
```sql
CREATE TABLE stripe_connections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
  stripe_account_id TEXT NOT NULL,          -- "acct_xxx"
  scope             TEXT NOT NULL DEFAULT 'read_write',
  connected_at      TIMESTAMPTZ DEFAULT now(),
  is_active         BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(tenant_id)
);
```

**processed_stripe_events** — webhook idempotency table
```sql
CREATE TABLE processed_stripe_events (
  stripe_event_id TEXT PRIMARY KEY,
  processed_at    TIMESTAMPTZ DEFAULT now()
);
```

### Seed data: 3 plans

| slug | name | monthly | annual | transaction_fee | features |
|------|------|---------|--------|-----------------|----------|
| `menu` | Digital Menu | $49 | $490 | 0% | `["digital-menu","qr-code","analytics"]` |
| `orders` | Menu + Orders | $99 | $990 | 0% | `["digital-menu","orders","qr-code","analytics"]` |
| `payments` | Menu + Payments | $179 | $1,790 | 0.5% | `["digital-menu","orders","payments","stripe-connect","analytics"]` |

### Grandfathering: Existing tenants

All existing tenants get `tenant_subscriptions` entry:
- plan_id → `payments` (highest tier)
- billing_cycle → `monthly`
- status → `active`
- override_notes → `'grandfathered on launch'`

### Feature gating rules

- `menu` plan: `orders_enabled = false` (forced)
- `orders` plan: `orders_enabled = true`, no Stripe
- `payments` plan: `orders_enabled = true`, Stripe Connect available

## Key Decisions to Make in Planning

1. **Migration strategy:** Supabase migration files vs inline SQL in route handlers
2. **`getTenantPlan` implementation:** DB query per call vs cached lookup
3. **Override resolution:** function returns resolved plan object, never mixed values
4. **Index strategy:** indexes on `tenant_subscriptions(tenant_id)` and `stripe_connections(tenant_id)`
5. **RLS policy:** plans table readable by all, tenant_subscriptions readable by owner/superadmin

## Related Files

- `src/types/database.ts` — currently has `Plan = 'free' | 'pro' | 'enterprise'` → needs update
- `supabase/migrations/` — next file: `029_plans_subscriptions.sql`
- `.env.local` — will need Stripe env vars (for later phases, not this one)
- `src/app/(admin)/settings/store/StoreClient.tsx` — will add "Subscription" tab (Phase 34)
- `src/app/(superadmin)/` — new pages in Phase 31

## Context from Previous Phases

- v1.9 shipped: profiles RLS indices, CDN cache headers, MenuPage decomposition
- v2.0 milestone started 2026-05-09 with SEED-009
- No existing Stripe code in codebase (greenfield)
- Current `database.ts` Plan type (`'free' | 'pro' | 'enterprise'`) is placeholder — replaced by DB-driven plan system