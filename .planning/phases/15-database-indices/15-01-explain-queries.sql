-- Phase 15 Plan 01 — EXPLAIN ANALYZE for public menu query paths
-- Run each section independently in Supabase SQL Editor
-- Replace placeholder UUIDs with real IDs from your database before running
--
-- Step 0: Run this helper first to get real UUIDs to substitute below
--
--   SELECT 'tenant' as type, id::text, slug FROM tenants LIMIT 3
--   UNION ALL
--   SELECT 'menu'   as type, id::text, slug FROM menus LIMIT 3
--   UNION ALL
--   SELECT 'category' as type, id::text, menu_id::text FROM categories LIMIT 3
--   UNION ALL
--   SELECT 'product'  as type, id::text, menu_id::text FROM products LIMIT 3;
--
-- How to find real IDs:
--   SELECT id, slug FROM tenants LIMIT 5;
--   SELECT id, tenant_id, slug FROM menus LIMIT 5;
--   SELECT id, menu_id FROM categories LIMIT 5;
--   SELECT id, menu_id FROM products LIMIT 5;
--
-- Placeholder UUIDs used below:
--   TENANT_ID   = 00000000-0000-0000-0000-000000000001
--   MENU_ID     = 00000000-0000-0000-0000-000000000002
--   PRODUCT_ID1 = 00000000-0000-0000-0000-000000000003
--   PRODUCT_ID2 = 00000000-0000-0000-0000-000000000004
--
-- After running Step 0, replace the placeholder values with real IDs before
-- executing Sections A–G.  Run one section at a time.

----------------------------------------------------------------------
--- SECTION A: /{slug} — tenant lookup (tenants.slug)
--- Route: src/app/(public)/[slug]/page.tsx  → getTenantBySlug()
--- Also used by: /{slug}/{menuSlug}/page.tsx → getTenantBySlug()
--- Expected: Index Scan using idx_tenants_slug (index exists)
----------------------------------------------------------------------
EXPLAIN ANALYZE
SELECT t.*, ts.*
FROM tenants t
LEFT JOIN tenant_settings ts ON ts.tenant_id = t.id
WHERE t.slug = 'restaurante-teste'
  AND t.is_active = true;

----------------------------------------------------------------------
--- SECTION B: /{slug} — default menu lookup (menus.tenant_id + is_default)
--- Route: src/app/(public)/[slug]/page.tsx  → first menus query
--- Expected: likely Seq Scan (no single-column index on menus.tenant_id)
----------------------------------------------------------------------
EXPLAIN ANALYZE
SELECT *
FROM menus
WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
  AND is_active = true
  AND is_default = true;

----------------------------------------------------------------------
--- SECTION C: /{slug} — fallback menu lookup (menus.tenant_id + ORDER BY position)
--- Route: src/app/(public)/[slug]/page.tsx  → fallback menus query
--- Expected: likely Seq Scan (no single-column index on menus.tenant_id)
----------------------------------------------------------------------
EXPLAIN ANALYZE
SELECT *
FROM menus
WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
  AND is_active = true
ORDER BY position
LIMIT 1;

----------------------------------------------------------------------
--- SECTION D: /{slug}/{menuSlug} — menu by slug lookup (menus.slug)
--- Route: src/app/(public)/[slug]/[menuSlug]/page.tsx  → menus query
--- Composite UNIQUE (tenant_id, slug) exists but may not serve slug-only lookups.
--- Expected: likely Seq Scan or suboptimal index use for slug-only filter
----------------------------------------------------------------------
EXPLAIN ANALYZE
SELECT *
FROM menus
WHERE slug = 'main'
  AND is_active = true;

----------------------------------------------------------------------
--- SECTION E: categories by menu_id
--- Route: both /{slug}/page.tsx and /{slug}/{menuSlug}/page.tsx
--- Expected: Seq Scan (no index on categories.menu_id)
----------------------------------------------------------------------
EXPLAIN ANALYZE
SELECT *
FROM categories
WHERE menu_id = '00000000-0000-0000-0000-000000000002'
  AND is_active = true
ORDER BY position;

----------------------------------------------------------------------
--- SECTION F: products by menu_id
--- Route: both /{slug}/page.tsx and /{slug}/{menuSlug}/page.tsx
--- Expected: Seq Scan (no index on products.menu_id)
----------------------------------------------------------------------
EXPLAIN ANALYZE
SELECT *
FROM products
WHERE menu_id = '00000000-0000-0000-0000-000000000002'
  AND is_available = true
ORDER BY position;

----------------------------------------------------------------------
--- SECTION G: product_option_groups by product_id IN (list)
--- Route: /{slug}/{menuSlug}/page.tsx (only when direct_orders_enabled = true)
--- Expected: Index Scan using idx_option_groups_product (index exists)
----------------------------------------------------------------------
EXPLAIN ANALYZE
SELECT *
FROM product_option_groups
WHERE product_id IN (
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000004'
)
ORDER BY position;
