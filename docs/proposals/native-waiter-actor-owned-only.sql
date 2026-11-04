-- PROPOSAL ONLY. Owned candidate only; never an automatic Supabase migration.
-- Actual candidate FK metadata confirmed read-only: one column, validated,
-- update NO ACTION, delete SET NULL, acknowledged_by -> auth.users(id).
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $target$ BEGIN
 IF current_database()<>'xmartmenu' THEN RAISE EXCEPTION 'Owned candidate required'; END IF;
END $target$;
LOCK TABLE public.waiter_calls,public.app_accounts,public.profiles,auth.users IN ACCESS EXCLUSIVE MODE;
DO $guard$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_constraint WHERE conrelid='public.waiter_calls'::regclass
   AND conname='waiter_calls_acknowledged_by_fkey' AND contype='f' AND confrelid='auth.users'::regclass
   AND cardinality(conkey)=1 AND confdeltype='n' AND confupdtype='a' AND convalidated
   AND pg_get_constraintdef(oid)='FOREIGN KEY (acknowledged_by) REFERENCES auth.users(id) ON DELETE SET NULL')
 THEN RAISE EXCEPTION 'Exact legacy waiter actor FK required'; END IF;
 IF EXISTS(SELECT FROM public.waiter_calls c LEFT JOIN public.app_accounts a ON a.id=c.acknowledged_by
   WHERE c.acknowledged_by IS NOT NULL AND a.id IS NULL)
 THEN RAISE EXCEPTION 'Unreconciled waiter actor UUIDs'; END IF;
END $guard$;
CREATE TEMP TABLE waiter_actor_before ON COMMIT DROP AS
 SELECT (SELECT md5(coalesce(jsonb_agg(to_jsonb(c) ORDER BY id)::text,'')) FROM public.waiter_calls c) calls,
 (SELECT md5(coalesce(jsonb_agg(to_jsonb(a) ORDER BY id)::text,'')) FROM public.app_accounts a) accounts,
 (SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY id)::text,'')) FROM public.profiles p) profiles,
 (SELECT md5(coalesce(jsonb_agg(to_jsonb(u) ORDER BY id)::text,'')) FROM auth.users u) auth;
ALTER TABLE public.waiter_calls DROP CONSTRAINT waiter_calls_acknowledged_by_fkey;
ALTER TABLE public.waiter_calls ADD CONSTRAINT waiter_calls_acknowledged_by_fkey
 FOREIGN KEY(acknowledged_by) REFERENCES public.app_accounts(id) ON DELETE SET NULL;
DO $unchanged$ BEGIN
 IF (SELECT calls FROM waiter_actor_before) IS DISTINCT FROM (SELECT md5(coalesce(jsonb_agg(to_jsonb(c) ORDER BY id)::text,'')) FROM public.waiter_calls c)
 OR (SELECT accounts FROM waiter_actor_before) IS DISTINCT FROM (SELECT md5(coalesce(jsonb_agg(to_jsonb(a) ORDER BY id)::text,'')) FROM public.app_accounts a)
 OR (SELECT profiles FROM waiter_actor_before) IS DISTINCT FROM (SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY id)::text,'')) FROM public.profiles p)
 OR (SELECT auth FROM waiter_actor_before) IS DISTINCT FROM (SELECT md5(coalesce(jsonb_agg(to_jsonb(u) ORDER BY id)::text,'')) FROM auth.users u)
 THEN RAISE EXCEPTION 'Waiter actor migration changed existing rows'; END IF;
END $unchanged$;
COMMIT;
