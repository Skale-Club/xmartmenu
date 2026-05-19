-- Migration 033: customer role + FK ON DELETE hardening
-- Round-2 audit findings P0-02, P1-04, P1-05.
-- Created: 2026-05-17
--
-- 1. profiles_role_check rejected 'customer', breaking quick-customer
--    register, staff DELETE downgrade, and superadmin user PATCH.
-- 2. tenant_subscriptions.plan_id FK was NO ACTION on delete; should be
--    RESTRICT so the DB enforces the same constraint the API does.
-- 3. scan_events.tenant_id FK was NO ACTION; should CASCADE consistent with
--    every other tenant-scoped child table.
-- 4. Backfill 4 orphan profiles (tenant_id IS NULL, role='store-admin'
--    leaked from the quick-customer-register failure path) to role='customer'
--    so they reflect the actual data state.
--
-- Idempotent: re-running is safe.

BEGIN;

-- ============================================================
-- profiles_role_check: add 'customer'
-- ============================================================

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role = ANY (ARRAY['superadmin','store-admin','store-staff','customer','admin']));
-- 'admin' kept transitionally; normalizeRole() collapses it to store-admin.

-- ============================================================
-- Backfill orphan store-admin profiles (tenant_id IS NULL) -> customer
-- These are the quick-customer-register failures from before this migration.
-- Safe: a tenant-less store-admin row has no tenant scope and can't do
-- anything anyway; relabelling to customer accurately reflects intent.
-- ============================================================

UPDATE profiles
SET role = 'customer'
WHERE tenant_id IS NULL
  AND role = 'store-admin';

-- ============================================================
-- tenant_subscriptions.plan_id: ON DELETE RESTRICT
-- ============================================================

ALTER TABLE tenant_subscriptions
  DROP CONSTRAINT IF EXISTS tenant_subscriptions_plan_id_fkey;
ALTER TABLE tenant_subscriptions
  ADD CONSTRAINT tenant_subscriptions_plan_id_fkey
  FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE RESTRICT;

-- ============================================================
-- scan_events.tenant_id: ON DELETE CASCADE
-- ============================================================

ALTER TABLE scan_events
  DROP CONSTRAINT IF EXISTS scan_events_tenant_id_fkey;
ALTER TABLE scan_events
  ADD CONSTRAINT scan_events_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

COMMIT;
