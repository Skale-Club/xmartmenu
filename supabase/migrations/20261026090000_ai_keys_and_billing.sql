-- AI keys and usage billing.
--
-- platform_ai_settings (one row) — set in Superadmin › AI & billing:
--   openrouter_api_key   the GLOBAL key (encrypted, same scheme as chat keys).
--                        Default for every client and fallback when a
--                        client's own key fails. Env OPENROUTER_API_KEY is the
--                        fallback when this is empty.
--   default_billing_mode for clients without their own choice.
--   default_markup_pct   our margin on AI cost billed to clients.
--   usd_to_brl           OpenRouter charges in USD, our Stripe plans in BRL.
--
-- tenant_ai_settings (one row per restaurant):
--   billing_mode  own_key   the client's OpenRouter key; they pay OpenRouter
--                           directly. If it fails (no credit / revoked), the
--                           call falls back to the global key and is billed.
--                 platform  our global key; we bill cost + margin monthly.
--                 included  our global key; not billed (demos, courtesy).
--                 NULL      → platform default.
--   markup_pct    NULL → platform default.
--   last_key_error / _at   why the client's key last failed (panel warning).
--
-- ai_usage_events: one row per OpenRouter call with its REAL cost
-- (usage.cost, USD). Billable rows are added to the client's next Stripe
-- invoice (invoice.created webhook or "Bill now"), then marked invoiced.
--
-- Keys are only read through server routes (service role): no RLS policy
-- exposes either settings table. Usage is readable by superadmins and owners.

CREATE TABLE IF NOT EXISTS public.platform_ai_settings (
  id                   SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  openrouter_api_key   TEXT,
  default_billing_mode TEXT NOT NULL DEFAULT 'platform' CHECK (default_billing_mode IN ('own_key', 'platform', 'included')),
  default_markup_pct   NUMERIC(6,2) NOT NULL DEFAULT 30 CHECK (default_markup_pct BETWEEN 0 AND 1000),
  usd_to_brl           NUMERIC(10,4) NOT NULL DEFAULT 5.50 CHECK (usd_to_brl > 0),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.platform_ai_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.tenant_ai_settings (
  tenant_id          UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  billing_mode       TEXT CHECK (billing_mode IS NULL OR billing_mode IN ('own_key', 'platform', 'included')),
  openrouter_api_key TEXT,
  markup_pct         NUMERIC(6,2) CHECK (markup_pct IS NULL OR markup_pct BETWEEN 0 AND 1000),
  last_key_error     TEXT,
  last_key_error_at  TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Clients who already pasted an OpenRouter key for the chat keep using it.
INSERT INTO public.tenant_ai_settings (tenant_id, billing_mode, openrouter_api_key)
SELECT tenant_id, 'own_key', openrouter_api_key
FROM public.chat_addon_settings
WHERE openrouter_api_key IS NOT NULL
ON CONFLICT (tenant_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ai_usage_events (
  id                     BIGSERIAL PRIMARY KEY,
  occurred_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id              UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  feature                TEXT NOT NULL,
  model                  TEXT,
  key_source             TEXT NOT NULL CHECK (key_source IN ('tenant', 'platform')),
  billable               BOOLEAN NOT NULL,
  cost_usd               NUMERIC(14,8) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  markup_pct             NUMERIC(6,2) NOT NULL DEFAULT 0,
  charge_usd             NUMERIC(14,8) NOT NULL DEFAULT 0 CHECK (charge_usd >= 0),
  generation_id          TEXT,
  request_id             TEXT,
  invoiced_at            TIMESTAMPTZ,
  stripe_invoice_item_id TEXT
);

CREATE INDEX IF NOT EXISTS ai_usage_events_tenant_idx ON public.ai_usage_events (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_events_unbilled_idx ON public.ai_usage_events (tenant_id, occurred_at)
  WHERE billable AND invoiced_at IS NULL;

ALTER TABLE public.platform_ai_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_ai_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_usage_superadmin_read ON public.ai_usage_events;
CREATE POLICY ai_usage_superadmin_read ON public.ai_usage_events
  FOR SELECT USING (public.is_superadmin());

DROP POLICY IF EXISTS ai_usage_owner_read ON public.ai_usage_events;
CREATE POLICY ai_usage_owner_read ON public.ai_usage_events
  FOR SELECT USING (
    tenant_id IS NOT NULL
    AND tenant_id = public.auth_tenant_id()
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('store-admin', 'admin'))
  );

-- Changes to keys, modes and margins land in the audit trail (keys redacted).
DROP TRIGGER IF EXISTS audit_row_change ON public.platform_ai_settings;
CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE OR DELETE ON public.platform_ai_settings
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('updated_at');
DROP TRIGGER IF EXISTS audit_row_change ON public.tenant_ai_settings;
CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE OR DELETE ON public.tenant_ai_settings
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('updated_at,last_key_error_at');
