-- "Call the waiter" from the table's menu link (QR code / NFC tag).
--
-- The guest taps "Call waiter" or "Ask for the bill"; the waiter app and the
-- orders screen get it live (realtime) and a staff member marks it handled.
-- Rows are created only by the public API route (service role), which checks
-- the table and the restaurant's plan and throttles repeats.

CREATE TABLE IF NOT EXISTS public.waiter_calls (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  table_id        UUID REFERENCES public.restaurant_tables(id) ON DELETE SET NULL,
  table_name      TEXT NOT NULL,
  reason          TEXT NOT NULL DEFAULT 'waiter' CHECK (reason IN ('waiter', 'bill')),
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'done')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_called_at  TIMESTAMPTZ NOT NULL DEFAULT now(),  -- bumped by a repeated tap
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  done_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS waiter_calls_open_idx ON public.waiter_calls (tenant_id, created_at DESC)
  WHERE status <> 'done';

ALTER TABLE public.waiter_calls ENABLE ROW LEVEL SECURITY;

-- Staff and owners of the restaurant see its calls (realtime respects this).
DROP POLICY IF EXISTS waiter_calls_staff_read ON public.waiter_calls;
CREATE POLICY waiter_calls_staff_read ON public.waiter_calls
  FOR SELECT USING (
    public.is_superadmin()
    OR (
      tenant_id = public.auth_tenant_id()
      AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('store-admin', 'store-staff', 'admin'))
    )
  );

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.waiter_calls;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
