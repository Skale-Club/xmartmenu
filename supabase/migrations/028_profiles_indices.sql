-- ============================================================
-- Migration 028: RLS profiles indices (v1.9 Performance Gaps)
-- Eliminates sequential scans on profiles caused by auth_tenant_id()
-- and is_superadmin() RLS helper functions called on every auth'd
-- DB request. Safe to run multiple times (IF NOT EXISTS everywhere).
-- Apply via: node scripts/apply-migration-028.mjs
-- ============================================================

-- profiles.tenant_id: auth_tenant_id() filters profiles by user_id to
-- resolve the caller's tenant. Without this index, every RLS-protected
-- query triggers a Seq Scan on profiles for the tenant_id column.
-- PERF-01
CREATE INDEX IF NOT EXISTS idx_profiles_tenant
  ON profiles(tenant_id);

-- profiles.role: is_superadmin() filters profiles WHERE role = 'superadmin'.
-- Without this index that filter is a sequential scan on every superadmin
-- RLS policy check. PERF-02
CREATE INDEX IF NOT EXISTS idx_profiles_role
  ON profiles(role);

-- profiles(tenant_id, role): composite index covering staff / permission
-- queries that filter on both columns simultaneously. PERF-03
CREATE INDEX IF NOT EXISTS idx_profiles_tenant_role
  ON profiles(tenant_id, role);

-- ============================================================
-- Verify after applying:
--   SELECT indexname, tablename, indexdef
--   FROM pg_indexes
--   WHERE schemaname = 'public'
--     AND indexname IN (
--       'idx_profiles_tenant',
--       'idx_profiles_role',
--       'idx_profiles_tenant_role'
--     )
--   ORDER BY indexname;
-- ============================================================
