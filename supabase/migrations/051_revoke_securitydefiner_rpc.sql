-- Migration 051: revoke public RPC EXECUTE on non-policy SECURITY DEFINER functions
-- (B03 / advisors 0028 & 0029).
--
-- handle_new_user() is an auth.users trigger; rls_auto_enable() is a maintenance
-- helper. Neither is invoked by the app via PostgREST RPC, and neither is used in
-- any RLS policy expression — so revoking EXECUTE from anon/authenticated removes
-- their /rest/v1/rpc/* exposure without affecting the trigger or RLS evaluation.
--
-- auth_tenant_id() and is_superadmin() are deliberately LEFT executable: they are
-- evaluated inside RLS policies, so authenticated/anon must retain EXECUTE or every
-- policy check would fail.
-- NOTE: EXECUTE is granted via the PUBLIC pseudo-role (Postgres default), which
-- anon/authenticated inherit — so the grant must be revoked FROM PUBLIC. The
-- trigger keeps firing (trigger execution does not check the caller's EXECUTE),
-- and the app never RPC-calls these functions.
BEGIN;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
COMMIT;
