-- ============================================================
-- Migration 024: Performance indices (Phase 15 — DB-01, DB-02, DB-03)
-- Evidence: .planning/phases/15-database-indices/15-01-explain-results.md
--           .planning/phases/15-database-indices/15-02-explain-results.md
-- Safe to run multiple times (uses IF NOT EXISTS everywhere)
-- Apply via: Supabase Dashboard → SQL Editor → Run
-- ============================================================
--
-- Missing indices identified by code analysis of query patterns in:
--   src/app/(public)/[slug]/page.tsx
--   src/app/(public)/[slug]/[menuSlug]/page.tsx
--
-- Plan 02 (orders + auth path) confirmed NO missing indices — all queries
-- covered by existing idx_orders_tenant, idx_orders_created_at, PKs, and
-- UNIQUE constraint indices. Only the public menu path requires new indices.
--
-- Estimated improvement: eliminates Seq Scan on menus, categories, and
-- products tables for all public menu page loads (/{slug} and /{slug}/{menuSlug}).
-- ============================================================

-- PUBLIC MENU PATH — /{slug} and /{slug}/{menuSlug}

-- menus.tenant_id: /{slug} route looks up default menu by tenant_id alone
-- (WHERE tenant_id = $1 AND is_active = true AND is_default = true).
-- The UNIQUE(tenant_id, slug) composite index does NOT serve tenant_id-only
-- equality filters efficiently when combined with is_default boolean predicate.
-- Phase 15 Plan 01 Sections B and C confirmed Seq Scan on menus(tenant_id).
CREATE INDEX IF NOT EXISTS idx_menus_tenant
  ON menus(tenant_id);

-- menus.slug: /{slug}/{menuSlug} route looks up menu by slug alone
-- (WHERE slug = $1 AND is_active = true). PostgreSQL cannot use the
-- UNIQUE(tenant_id, slug) composite index for a slug-only equality filter —
-- slug is the trailing column in the composite, so a full scan is required.
-- Phase 15 Plan 01 Section D confirmed Seq Scan on menus(slug).
CREATE INDEX IF NOT EXISTS idx_menus_slug
  ON menus(slug);

-- categories.menu_id: both public routes filter categories by menu_id
-- (WHERE menu_id = $1 AND is_active = true ORDER BY position).
-- Existing idx_categories_tenant covers tenant_id only — not used here.
-- Phase 15 Plan 01 Section E confirmed Seq Scan on categories(menu_id).
CREATE INDEX IF NOT EXISTS idx_categories_menu
  ON categories(menu_id);

-- products.menu_id: both public routes filter products by menu_id
-- (WHERE menu_id = $1 AND is_available = true ORDER BY position).
-- Existing idx_products_tenant covers tenant_id only; idx_products_category
-- covers category_id only — neither is used for menu_id-filtered queries.
-- Phase 15 Plan 01 Section F confirmed Seq Scan on products(menu_id).
CREATE INDEX IF NOT EXISTS idx_products_menu
  ON products(menu_id);

-- ============================================================
-- Done. No schema cache reload needed — indices are transparent to the ORM.
-- Verify after applying with:
--   SELECT indexname, tablename, indexdef
--   FROM pg_indexes
--   WHERE schemaname = 'public'
--     AND indexname IN (
--       'idx_menus_tenant', 'idx_menus_slug',
--       'idx_categories_menu', 'idx_products_menu'
--     )
--   ORDER BY tablename, indexname;
-- ============================================================
