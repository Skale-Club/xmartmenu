-- Phase 15 Plan 02 — EXPLAIN ANALYZE for orders + tenant-auth query paths
-- Generated: 2026-05-08
-- Purpose: Identify Seq Scan vs Index Scan for orders API route and auth/tenant-lookup middleware
--
-- HOW TO RUN
-- ----------
-- 1. Open Supabase Dashboard → SQL Editor
-- 2. Run the helper queries at the bottom of this file to collect real UUIDs
-- 3. Replace every placeholder UUID with a real ID from your database
-- 4. Run each SECTION independently (paste one section at a time)
-- 5. Look for "Seq Scan" vs "Index Scan" in each plan output
-- 6. Record the index name shown when Index Scan appears
--
-- How to find real UUIDs:
--   SELECT id FROM tenants LIMIT 3;
--   SELECT id, tenant_id FROM orders LIMIT 3;
--   SELECT id FROM profiles LIMIT 3;
--   SELECT id, tenant_id FROM tenant_settings LIMIT 3;
--
-- Placeholder convention:
--   00000000-0000-0000-0000-000000000001  →  replace with a real tenant id
--   00000000-0000-0000-0000-000000000005  →  replace with a real profile/user id
-- ============================================================


-- ============================================================
-- SECTION A: POST /api/orders — tenant validation (lookup by id, not slug)
-- ============================================================
-- Source: src/app/api/orders/route.ts (line 41-46)
--   service.from('tenants')
--         .select('id, is_active, tenant_settings(orders_enabled)')
--         .eq('id', tenant_id)
--         .eq('is_active', true)
--         .single()
--
-- Expected: Index Scan using tenants_pkey (PK lookup on id column)
-- Expected: Index Scan on tenant_settings using tenant_settings_tenant_id_key (UNIQUE constraint)
-- ============================================================

EXPLAIN ANALYZE
SELECT t.id, t.is_active, ts.orders_enabled
FROM tenants t
LEFT JOIN tenant_settings ts ON ts.tenant_id = t.id
WHERE t.id = '00000000-0000-0000-0000-000000000001'
  AND t.is_active = true;


-- ============================================================
-- SECTION B: GET /api/orders — admin orders list with items
-- ============================================================
-- Source: src/app/api/orders/route.ts (line 113-117)
--   service.from('orders')
--         .select('*, order_items(*)')
--         .eq('tenant_id', tenantId)
--         .order('created_at', { ascending: false })
--
-- Supabase translates .select('*, order_items(*)') into a JOIN or subquery.
-- This approximates the planner cost for the orders scan + items join.
--
-- Existing indices:
--   idx_orders_tenant     ON orders(tenant_id)   [migration 019]
--   idx_orders_created_at ON orders(created_at)  [migration 019]
--   idx_order_items_order ON order_items(order_id) [migration 019]
--
-- Expected: Index Scan using idx_orders_tenant on orders(tenant_id)
-- Expected: Index Scan using idx_order_items_order on order_items(order_id)
-- Note: Postgres may choose idx_orders_tenant only and sort created_at in memory
--       if the index on tenant_id is selective enough. Both are acceptable.
-- ============================================================

EXPLAIN ANALYZE
SELECT o.*, oi.*
FROM orders o
LEFT JOIN order_items oi ON oi.order_id = o.id
WHERE o.tenant_id = '00000000-0000-0000-0000-000000000001'
ORDER BY o.created_at DESC;


-- ============================================================
-- SECTION C: RLS helper — auth_tenant_id() simulation
-- ============================================================
-- Source: supabase/migrations/001_initial_schema.sql (line 145-148)
--   CREATE OR REPLACE FUNCTION auth_tenant_id()
--   RETURNS UUID AS $$
--     SELECT tenant_id FROM profiles WHERE id = auth.uid();
--   $$ LANGUAGE SQL STABLE SECURITY DEFINER;
--
-- This function runs implicitly on every RLS-protected query executed
-- by authenticated users (dashboard, menu admin, orders admin).
--
-- Expected: Index Scan using profiles_pkey (PK lookup on id column)
-- ============================================================

EXPLAIN ANALYZE
SELECT tenant_id
FROM profiles
WHERE id = '00000000-0000-0000-0000-000000000005';


-- ============================================================
-- SECTION D: RLS helper — is_superadmin() simulation
-- ============================================================
-- Source: supabase/migrations/001_initial_schema.sql (line 151-155)
--   CREATE OR REPLACE FUNCTION is_superadmin()
--   RETURNS BOOLEAN AS $$
--     SELECT EXISTS (
--       SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'superadmin'
--     );
--   $$ LANGUAGE SQL STABLE SECURITY DEFINER;
--
-- Runs on every RLS policy that calls is_superadmin() (orders, tenants, etc.).
-- Filters on id (PK) first, so role check is applied only to a single row.
--
-- Expected: Index Scan using profiles_pkey (PK lookup on id)
-- Note: No index on profiles(role) is needed — id filter reduces to 1 row.
-- ============================================================

EXPLAIN ANALYZE
SELECT EXISTS(
  SELECT 1 FROM profiles
  WHERE id = '00000000-0000-0000-0000-000000000005'
    AND role = 'superadmin'
);


-- ============================================================
-- SECTION E: orders INSERT — write path cost estimation
-- ============================================================
-- Source: src/app/api/orders/route.ts (line 59-66)
--   service.from('orders').insert({
--     tenant_id, customer_name, customer_phone, status: 'pending', total
--   })
--
-- Using EXPLAIN without ANALYZE to avoid inserting fake data.
-- INSERTs have no scan cost — expected node: ModifyTable (no Seq Scan).
-- Index overhead for idx_orders_tenant, idx_orders_created_at will be visible
-- as index maintenance nodes in the plan.
-- ============================================================

EXPLAIN
INSERT INTO orders (tenant_id, customer_name, customer_phone, status, total)
VALUES ('00000000-0000-0000-0000-000000000001', 'Test Customer', '11999999999', 'pending', 50.00);


-- ============================================================
-- SECTION F: tenant_settings join efficiency (RLS + settings reads)
-- ============================================================
-- Source: supabase/migrations/001_initial_schema.sql
--   tenant_settings has UNIQUE(tenant_id) constraint — creates implicit index.
--   Also queried via the RLS policy "orders_public_insert" in migration 020:
--     EXISTS (SELECT 1 FROM tenants t JOIN tenant_settings ts ON ts.tenant_id = t.id
--             WHERE t.id = orders.tenant_id AND t.is_active = true AND ts.orders_enabled = true)
--
-- Expected: Index Scan using tenant_settings_tenant_id_key (UNIQUE constraint on tenant_id)
-- ============================================================

EXPLAIN ANALYZE
SELECT *
FROM tenant_settings
WHERE tenant_id = '00000000-0000-0000-0000-000000000001';


-- ============================================================
-- BONUS: Middleware profiles lookup (forced password change check)
-- ============================================================
-- Source: src/lib/supabase/middleware.ts (line 72-77)
--   supabase.from('profiles')
--           .select('role, must_change_password')
--           .eq('id', user.id)
--           .single()
--
-- This runs on EVERY authenticated page request (dashboard, menu, settings).
-- Expected: Index Scan using profiles_pkey (PK lookup on id)
-- Functionally identical to Section C — included separately for completeness.
-- ============================================================

EXPLAIN ANALYZE
SELECT role, must_change_password
FROM profiles
WHERE id = '00000000-0000-0000-0000-000000000005';


-- ============================================================
-- UUID HELPER QUERIES — run these first to collect real IDs
-- ============================================================
-- Uncomment and run each block to get real UUIDs for substitution above.

-- SELECT id, name, slug FROM tenants LIMIT 5;
-- SELECT id, tenant_id, customer_name, status FROM orders LIMIT 5;
-- SELECT id, tenant_id FROM tenant_settings LIMIT 5;
-- SELECT id, role, tenant_id FROM profiles LIMIT 5;
