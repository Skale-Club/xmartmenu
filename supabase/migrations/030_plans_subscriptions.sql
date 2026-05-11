-- Migration 029: Plans, Subscriptions, and Stripe Connect Schema
-- Phase A of SEED-009 (Plans, Pricing & Stripe Connect Monetization)
-- Created: 2026-05-09

BEGIN;

-- ============================================================
-- Table: plans (lookup table for subscription tiers)
-- ============================================================
CREATE TABLE plans (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                     TEXT NOT NULL,
  slug                     TEXT NOT NULL UNIQUE,
  description              TEXT,
  monthly_price            NUMERIC(10,2) NOT NULL,
  annual_price             NUMERIC(10,2) NOT NULL,
  transaction_fee_pct      NUMERIC(5,4) DEFAULT 0,
  features                 JSONB NOT NULL DEFAULT '[]',
  is_active                BOOLEAN NOT NULL DEFAULT true,
  sort_order               INT NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ DEFAULT now(),
  updated_at               TIMESTAMPTZ DEFAULT now()
);

-- Index for fetching active plans ordered by sort_order
CREATE INDEX idx_plans_active_sort ON plans(is_active, sort_order) WHERE is_active = true;

-- ============================================================
-- Table: tenant_subscriptions (per-tenant subscription)
-- ============================================================
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
  override_notes                TEXT,
  -- Stripe (for payments plan)
  stripe_customer_id            TEXT,
  stripe_subscription_id        TEXT,
  current_period_start          TIMESTAMPTZ,
  current_period_end            TIMESTAMPTZ,
  created_at                    TIMESTAMPTZ DEFAULT now(),
  updated_at                   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id)
);

-- Index for tenant lookup
CREATE INDEX idx_tenant_subscriptions_tenant ON tenant_subscriptions(tenant_id);

-- Index for plan lookup
CREATE INDEX idx_tenant_subscriptions_plan ON tenant_subscriptions(plan_id);

-- ============================================================
-- Table: stripe_connections (per-tenant Stripe Connect)
-- ============================================================
CREATE TABLE stripe_connections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
  stripe_account_id TEXT NOT NULL,
  scope             TEXT NOT NULL DEFAULT 'read_write',
  connected_at      TIMESTAMPTZ DEFAULT now(),
  is_active         BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(tenant_id)
);

-- Index for tenant lookup
CREATE INDEX idx_stripe_connections_tenant ON stripe_connections(tenant_id);

-- ============================================================
-- Table: processed_stripe_events (webhook idempotency)
-- ============================================================
CREATE TABLE processed_stripe_events (
  stripe_event_id TEXT PRIMARY KEY,
  processed_at    TIMESTAMPTZ DEFAULT now()
);

-- Index for cleanup queries
CREATE INDEX idx_processed_stripe_events_processed ON processed_stripe_events(processed_at);

-- ============================================================
-- RLS Policies
-- ============================================================

-- Plans: readable by all authenticated users
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Plans are viewable by authenticated users"
  ON plans FOR SELECT
  TO authenticated
  USING (true);

-- tenant_subscriptions: readable by tenant owner and superadmin
ALTER TABLE tenant_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant subscription visible to tenant owner"
  ON tenant_subscriptions FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Tenant subscription visible to superadmin"
  ON tenant_subscriptions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role = 'superadmin'
    )
  );

-- stripe_connections: readable by tenant owner and superadmin
ALTER TABLE stripe_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Stripe connection visible to tenant owner"
  ON stripe_connections FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT tenant_id FROM profiles WHERE id = auth.uid()
    )
  );

CREATE POLICY "Stripe connection visible to superadmin"
  ON stripe_connections FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role = 'superadmin'
    )
  );

-- processed_stripe_events: readable/writable by service role only
ALTER TABLE processed_stripe_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Processed events accessible to service role"
  ON processed_stripe_events FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- Seed Data: 3 Base Plans
-- ============================================================

INSERT INTO plans (id, name, slug, description, monthly_price, annual_price, transaction_fee_pct, features, sort_order)
VALUES
  (
    '11111111-1111-1111-1111-111111111111',
    'Digital Menu',
    'menu',
    'Perfect for restaurants that just need a beautiful digital menu with QR codes',
    49.00,
    490.00,
    0,
    '["digital-menu","qr-code","analytics"]',
    1
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'Menu + Orders',
    'orders',
    'For restaurants wanting to accept digital orders with order management',
    99.00,
    990.00,
    0,
    '["digital-menu","orders","qr-code","analytics"]',
    2
  ),
  (
    '33333333-3333-3333-3333-333333333333',
    'Menu + Payments',
    'payments',
    'Full solution with Stripe Connect for accepting payments directly',
    179.00,
    1790.00,
    0.0050,
    '["digital-menu","orders","payments","stripe-connect","analytics"]',
    3
  );

-- ============================================================
-- Grandfathering: Existing tenants get payments plan
-- ============================================================

INSERT INTO tenant_subscriptions (tenant_id, plan_id, billing_cycle, status, override_notes)
SELECT 
  t.id,
  '33333333-3333-3333-3333-333333333333',
  'monthly',
  'active',
  'grandfathered on launch'
FROM tenants t
WHERE t.is_active = true
ON CONFLICT (tenant_id) DO NOTHING;

COMMIT;