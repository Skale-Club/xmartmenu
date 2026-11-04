-- PROPOSAL ONLY: owned candidate, never a Supabase migration or auto-apply.
-- Review immutable HEAD + backup + actual FK/role/grant metadata before apply.
-- No auth.users insert/update/delete; no existing UUID, role or membership edit.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $guard$ BEGIN
 IF current_database()<>'xmartmenu' THEN RAISE EXCEPTION 'Owned candidate required'; END IF;
 IF NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid='public.profiles'::regclass
   AND conname='profiles_id_fkey' AND contype='f' AND confrelid='auth.users'::regclass
   AND confdeltype='c' AND convalidated AND pg_get_constraintdef(oid)='FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE')
 THEN RAISE EXCEPTION 'Exact legacy profile FK required'; END IF;
 IF (SELECT count(*) FROM public.app_accounts)<>7
 OR EXISTS(SELECT FROM public.profiles p LEFT JOIN public.app_accounts a ON a.id=p.id WHERE a.id IS NULL)
 OR EXISTS(SELECT FROM public.app_accounts a LEFT JOIN public.profiles p ON p.id=a.id WHERE p.id IS NULL)
 THEN RAISE EXCEPTION 'Reviewed seven-account baseline required'; END IF;
END $guard$;
LOCK TABLE public.profiles,public.app_accounts,public.app_identity_bindings,public.app_sessions,auth.users IN ACCESS EXCLUSIVE MODE;
CREATE TEMP TABLE native_registration_before ON COMMIT DROP AS
 SELECT (SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY id)::text,'')) FROM public.profiles p) profiles,
 (SELECT md5(coalesce(jsonb_agg(to_jsonb(a) ORDER BY id)::text,'')) FROM public.app_accounts a) accounts,
 (SELECT md5(coalesce(jsonb_agg(to_jsonb(b) ORDER BY project_id,subject)::text,'')) FROM public.app_identity_bindings b) bindings,
 (SELECT md5(coalesce(jsonb_agg(to_jsonb(s) ORDER BY token_hash)::text,'')) FROM public.app_sessions s) sessions,
 (SELECT md5(coalesce(jsonb_agg(to_jsonb(u) ORDER BY id)::text,'')) FROM auth.users u) auth;
ALTER TABLE public.profiles DROP CONSTRAINT profiles_id_fkey;
-- app_accounts has no FK to profiles on the actual candidate. Do not add a
-- cyclic reverse FK. Registration enforces the shared UUID in one transaction.
ALTER TABLE public.app_identity_bindings DROP CONSTRAINT app_identity_bindings_binding_proof_check;
ALTER TABLE public.app_identity_bindings ADD CONSTRAINT app_identity_bindings_binding_proof_check
 CHECK(binding_proof IN('legacy-session','owned-session','google-subject','operator-recovery','native-registration'));
DO $unchanged$ BEGIN
 IF (SELECT profiles FROM native_registration_before) IS DISTINCT FROM (SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY id)::text,'')) FROM public.profiles p)
 OR (SELECT accounts FROM native_registration_before) IS DISTINCT FROM (SELECT md5(coalesce(jsonb_agg(to_jsonb(a) ORDER BY id)::text,'')) FROM public.app_accounts a)
 OR (SELECT bindings FROM native_registration_before) IS DISTINCT FROM (SELECT md5(coalesce(jsonb_agg(to_jsonb(b) ORDER BY project_id,subject)::text,'')) FROM public.app_identity_bindings b)
 OR (SELECT sessions FROM native_registration_before) IS DISTINCT FROM (SELECT md5(coalesce(jsonb_agg(to_jsonb(s) ORDER BY token_hash)::text,'')) FROM public.app_sessions s)
 OR (SELECT auth FROM native_registration_before) IS DISTINCT FROM (SELECT md5(coalesce(jsonb_agg(to_jsonb(u) ORDER BY id)::text,'')) FROM auth.users u)
 THEN RAISE EXCEPTION 'Existing account data changed'; END IF;
END $unchanged$;
COMMIT;
