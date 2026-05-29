-- Migration 050: drop the permissive anon INSERT policy on orders (S13 residual)
-- Orders are created exclusively via the service-role client in /api/orders
-- (which bypasses RLS), so `orders_public_insert` (WITH CHECK true) was unused by
-- the app and only exposed a direct-SDK abuse surface — the last remaining
-- Supabase advisor `rls_policy_always_true` finding. Scoped read/management
-- policies on orders are unaffected.
BEGIN;
DROP POLICY IF EXISTS "orders_public_insert" ON orders;
COMMIT;
