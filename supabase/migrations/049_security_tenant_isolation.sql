-- Migration 049: Security remediation — tenant isolation & storage hardening
-- Phase 2 (Remediation) of the XmartMenu security review.
-- Addresses audit items S13 (tenant isolation) and S08 (file uploads / storage).
-- Created: 2026-05-29
--
-- NOTE: This content was authored and applied to the production database on
-- 2026-05-29 (on the feat/security-tenant-isolation branch it carried the number
-- 046, which collided with main's 046_rebrand_color_defaults.sql). Renumbered to
-- 049 here to preserve ordering on main. The migration is idempotent, so the file
-- number does not affect the already-applied result.
--
-- Verified against the LIVE database before authoring:
--   * delivery_zones already had RLS ENABLED but ZERO policies → it denied all
--     non-service access, which also silently broke the public menu's delivery-zone
--     reads (anon client). Adding policies fixes both isolation and that lockout.
--   * order_items.order_items_public_insert and scan_events.scan_insert_anon were
--     permissive INSERT policies (WITH CHECK true). The app inserts both via the
--     service-role client (which bypasses RLS), so removing the anon policies does
--     not change application behavior — it only closes direct-SDK abuse.
--   * storage buckets product-images & tenant-assets are public, with a broad
--     public SELECT policy (allowed cross-tenant file listing) and INSERT/UPDATE
--     scoped only by bucket_id. Every upload path uses `{tenantId}/...` as the
--     first segment, so scoping writes to the tenant folder is safe.
--   * auth_tenant_id / is_superadmin / handle_new_user already had a pinned
--     search_path; only update_updated_at & set_stripe_connections_updated_at
--     remained mutable.
--
-- Idempotent: DROP ... IF EXISTS before each CREATE so re-applying is safe.

BEGIN;

-- ============================================================
-- S13.1 — delivery_zones: tenant-scoped policies
-- ============================================================
ALTER TABLE delivery_zones ENABLE ROW LEVEL SECURITY; -- no-op if already enabled

DROP POLICY IF EXISTS "delivery_zones_admin" ON delivery_zones;
CREATE POLICY "delivery_zones_admin" ON delivery_zones FOR ALL
  USING (tenant_id = auth_tenant_id() OR is_superadmin())
  WITH CHECK (tenant_id = auth_tenant_id() OR is_superadmin());

DROP POLICY IF EXISTS "delivery_zones_public_read" ON delivery_zones;
CREATE POLICY "delivery_zones_public_read" ON delivery_zones FOR SELECT
  USING (is_active = true);

-- ============================================================
-- S13.2 — remove permissive anon INSERT policies
-- (inserts run server-side via the service-role client)
-- ============================================================
DROP POLICY IF EXISTS "order_items_public_insert" ON order_items;
DROP POLICY IF EXISTS "scan_insert_anon" ON scan_events;

-- ============================================================
-- S13.3 — pin search_path on the two remaining mutable trigger functions
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_stripe_connections_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

-- ============================================================
-- S08 — storage: scope writes to the tenant folder; stop cross-tenant listing
-- Buckets are public, so dropping the broad public SELECT policy does NOT affect
-- public object-URL access (it only governs the list/SELECT API).
-- ============================================================

-- product-images
DROP POLICY IF EXISTS "auth upload product-images" ON storage.objects;
CREATE POLICY "auth upload product-images" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'product-images'
    AND ((storage.foldername(name))[1] = auth_tenant_id()::text OR is_superadmin())
  );

DROP POLICY IF EXISTS "auth update product-images" ON storage.objects;
CREATE POLICY "auth update product-images" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'product-images'
    AND ((storage.foldername(name))[1] = auth_tenant_id()::text OR is_superadmin())
  )
  WITH CHECK (
    bucket_id = 'product-images'
    AND ((storage.foldername(name))[1] = auth_tenant_id()::text OR is_superadmin())
  );

DROP POLICY IF EXISTS "public read product-images" ON storage.objects;

-- tenant-assets
DROP POLICY IF EXISTS "auth upload tenant-assets" ON storage.objects;
CREATE POLICY "auth upload tenant-assets" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'tenant-assets'
    AND ((storage.foldername(name))[1] = auth_tenant_id()::text OR is_superadmin())
  );

DROP POLICY IF EXISTS "auth update tenant-assets" ON storage.objects;
CREATE POLICY "auth update tenant-assets" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'tenant-assets'
    AND ((storage.foldername(name))[1] = auth_tenant_id()::text OR is_superadmin())
  )
  WITH CHECK (
    bucket_id = 'tenant-assets'
    AND ((storage.foldername(name))[1] = auth_tenant_id()::text OR is_superadmin())
  );

DROP POLICY IF EXISTS "public read tenant-assets" ON storage.objects;

COMMIT;
