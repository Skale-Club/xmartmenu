-- EX-04: payments that do not match their order are recorded for a person to
-- reconcile instead of being applied or silently dropped: a payment confirmed
-- after the order was cancelled, a charge below the order total, a currency or
-- restaurant mismatch, a second intent paid for an order already paid.
-- Nothing here refunds or reopens anything automatically.

CREATE TABLE IF NOT EXISTS public.payment_divergences (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          UUID REFERENCES public.orders(id) ON DELETE SET NULL,
  tenant_id         UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  payment_intent_id TEXT NOT NULL,
  kind              TEXT NOT NULL,
  amount_minor      BIGINT,
  currency          TEXT,
  details           JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (payment_intent_id, kind)
);

ALTER TABLE public.payment_divergences ENABLE ROW LEVEL SECURITY;
-- Server-only (service role): no policy for anon/authenticated.
REVOKE ALL ON public.payment_divergences FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS payment_divergences_open
  ON public.payment_divergences (created_at DESC) WHERE resolved_at IS NULL;
