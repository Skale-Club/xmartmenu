-- Migration 032: Payments schema fix
-- Reconciles schema with code shipped in Phases 32-34 (Stripe Connect monetization).
-- Created: 2026-05-17
--
-- Background: The Stripe Connect feature was implemented assuming columns
-- and statuses that were never added to the database. This migration backfills
-- the missing schema so the payment flow actually works end-to-end.
--
-- Idempotent: every change uses IF EXISTS / IF NOT EXISTS / DO $$ ... $$ guards
-- so re-applying is safe.

BEGIN;

-- ============================================================
-- orders: payment_intent_id + extended status check
-- ============================================================

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_intent_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'orders_payment_intent_id_key'
  ) THEN
    CREATE UNIQUE INDEX orders_payment_intent_id_key
      ON orders(payment_intent_id)
      WHERE payment_intent_id IS NOT NULL;
  END IF;
END$$;

-- Replace status CHECK to include payment statuses
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending','preparing','ready','done','cancelled','paid','payment_failed'));

-- ============================================================
-- processed_stripe_events: rename + new column
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'processed_stripe_events'
      AND column_name = 'stripe_event_id'
  ) THEN
    ALTER TABLE processed_stripe_events RENAME COLUMN stripe_event_id TO event_id;
  END IF;
END$$;

ALTER TABLE processed_stripe_events
  ADD COLUMN IF NOT EXISTS event_type TEXT;

-- ============================================================
-- stripe_connections: lifecycle columns
-- ============================================================

ALTER TABLE stripe_connections
  ADD COLUMN IF NOT EXISTS disconnected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Backfill created_at for existing rows (from connected_at if present)
UPDATE stripe_connections
SET created_at = COALESCE(created_at, connected_at, now())
WHERE created_at IS NULL;

-- Auto-updated_at trigger
CREATE OR REPLACE FUNCTION set_stripe_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stripe_connections_updated_at ON stripe_connections;
CREATE TRIGGER trg_stripe_connections_updated_at
  BEFORE UPDATE ON stripe_connections
  FOR EACH ROW
  EXECUTE FUNCTION set_stripe_connections_updated_at();

-- ============================================================
-- tenant_subscriptions: cancel_at_period_end
-- ============================================================

ALTER TABLE tenant_subscriptions
  ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT false;

COMMIT;
