-- Migration 052: Stripe Product/Price IDs on plans
-- Created: 2026-06-13
--
-- Background: SaaS plan subscriptions (R$49/99/179) were never charged via
-- Stripe — tenant_subscriptions was populated by grandfathering / manual
-- superadmin assignment and stripe_subscription_id / current_period_* were
-- never written. To bill plans for real we attach Stripe Product + recurring
-- Price IDs to each plan (3 plans x monthly/annual). The IDs are populated by
-- `npm run stripe:setup-plans`, which creates/ensures the resources in Stripe.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

BEGIN;

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS stripe_product_id       TEXT,
  ADD COLUMN IF NOT EXISTS stripe_price_monthly_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_price_annual_id  TEXT;

COMMIT;
