-- EX-01 hotfix: privilege escalation through profiles, and cross-tenant
-- analytics readable by anyone.
--
-- 1. profiles_update_self only checked `id = auth.uid()`, and Supabase's default
--    grants give anon/authenticated UPDATE on every column. is_superadmin() and
--    auth_tenant_id() read profiles.role / profiles.tenant_id, so any signed-in
--    account could PATCH /rest/v1/profiles and become superadmin or join another
--    restaurant. Accounts now update only their personal fields; role and tenant
--    changes go through the server (service role), which is how every admin,
--    superadmin, onboarding and MCP path already writes them.
--
-- 2. get_menu_analytics_overview / _product_ / _upsell_ are SECURITY DEFINER and
--    take p_tenant_id without checking the caller. Their migrations revoked
--    EXECUTE from PUBLIC, but Supabase grants it to anon and authenticated
--    explicitly, so the revoke did nothing. Only the admin analytics page calls
--    them, with the service role.
--
-- Additive and compatible with the current code: no column, no data change.

-- ─── profiles ────────────────────────────────────────────────────────────────

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.profiles FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.profiles FROM authenticated;

-- The only self-service write is the password page clearing the forced change.
GRANT UPDATE (full_name, phone, must_change_password, password_changed_at)
  ON public.profiles TO authenticated;

DROP POLICY IF EXISTS "profiles_update_self" ON public.profiles;
CREATE POLICY "profiles_update_self" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Second line of defence: even if a later migration widens the column grants
-- again, a request made with an end-user token cannot change who the account
-- is or which restaurant it belongs to. The service role (server code) and
-- database-owned paths (triggers, migrations) are not affected.
CREATE OR REPLACE FUNCTION public.guard_profile_privileges()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') IN ('anon', 'authenticated')
     AND (NEW.id IS DISTINCT FROM OLD.id
          OR NEW.role IS DISTINCT FROM OLD.role
          OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
    RAISE EXCEPTION 'profiles.role, profiles.tenant_id and profiles.id are managed by the server'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.guard_profile_privileges() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_profile_privileges ON public.profiles;
CREATE TRIGGER guard_profile_privileges
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_privileges();

-- ─── analytics RPCs ──────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.get_menu_analytics_overview(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_menu_product_analytics(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_menu_upsell_analytics(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_menu_analytics_overview(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_menu_product_analytics(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_menu_upsell_analytics(UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, UUID) TO service_role;

-- Functions created later in public must not be callable by anon/authenticated
-- unless a migration grants it on purpose (Supabase's default is to grant).
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
