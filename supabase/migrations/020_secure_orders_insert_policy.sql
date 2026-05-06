-- SEC-01 defense-in-depth: replace the open INSERT policy on orders
-- The API layer (orders/route.ts) is the primary defense (service role bypasses RLS).
-- This policy blocks direct Supabase SDK inserts that bypass the API.

DROP POLICY IF EXISTS "orders_public_insert" ON orders;

CREATE POLICY "orders_public_insert" ON orders FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tenants t
      JOIN tenant_settings ts ON ts.tenant_id = t.id
      WHERE t.id = orders.tenant_id
        AND t.is_active = true
        AND ts.orders_enabled = true
    )
  );
