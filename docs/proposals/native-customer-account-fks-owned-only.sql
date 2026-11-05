-- PROPOSAL ONLY. Owned candidate, never a Source/automatic migration.
-- Source metadata verified READ ONLY: both FKs validated; unchanged actions.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';
DO $target$ BEGIN
 IF current_database()<>'xmartmenu' OR current_user<>'xmartmenu_owner'
 OR (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database())<>'xmartmenu_owner'
 THEN RAISE EXCEPTION 'Exact owned candidate owner required'; END IF;
END $target$;
LOCK TABLE public.customer_profiles,public.orders,public.app_accounts,auth.users IN ACCESS EXCLUSIVE MODE;
DO $guard$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_constraint WHERE conrelid='public.customer_profiles'::regclass
   AND conname='customer_profiles_id_fkey' AND contype='f' AND confrelid='auth.users'::regclass
   AND cardinality(conkey)=1 AND convalidated AND confdeltype='c' AND confupdtype='a'
   AND pg_get_constraintdef(oid)='FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE')
 OR NOT EXISTS(SELECT FROM pg_constraint WHERE conrelid='public.orders'::regclass
   AND conname='orders_customer_id_fkey' AND contype='f' AND confrelid='auth.users'::regclass
   AND cardinality(conkey)=1 AND convalidated AND confdeltype='n' AND confupdtype='a'
   AND pg_get_constraintdef(oid)='FOREIGN KEY (customer_id) REFERENCES auth.users(id) ON DELETE SET NULL')
 THEN RAISE EXCEPTION 'Exact legacy customer FKs required'; END IF;
 IF EXISTS(SELECT FROM public.customer_profiles p LEFT JOIN public.app_accounts a ON a.id=p.id WHERE a.id IS NULL)
 OR EXISTS(SELECT FROM public.orders o LEFT JOIN public.app_accounts a ON a.id=o.customer_id
   WHERE o.customer_id IS NOT NULL AND a.id IS NULL)
 THEN RAISE EXCEPTION 'Unreconciled customer account UUIDs'; END IF;
END $guard$;
CREATE TEMP TABLE native_customer_fks_before ON COMMIT DROP AS
 SELECT (SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY id)::text,'')) FROM public.customer_profiles r) profiles,
 (SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY id)::text,'')) FROM public.orders r) orders,
 (SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY id)::text,'')) FROM public.app_accounts r) accounts,
 (SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY id)::text,'')) FROM auth.users r) auth;
ALTER TABLE public.customer_profiles DROP CONSTRAINT customer_profiles_id_fkey;
ALTER TABLE public.customer_profiles ADD CONSTRAINT customer_profiles_id_fkey
 FOREIGN KEY(id) REFERENCES public.app_accounts(id) ON DELETE CASCADE;
ALTER TABLE public.orders DROP CONSTRAINT orders_customer_id_fkey;
ALTER TABLE public.orders ADD CONSTRAINT orders_customer_id_fkey
 FOREIGN KEY(customer_id) REFERENCES public.app_accounts(id) ON DELETE SET NULL;
DO $unchanged$ BEGIN
 IF (SELECT profiles FROM native_customer_fks_before) IS DISTINCT FROM (SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY id)::text,'')) FROM public.customer_profiles r)
 OR (SELECT orders FROM native_customer_fks_before) IS DISTINCT FROM (SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY id)::text,'')) FROM public.orders r)
 OR (SELECT accounts FROM native_customer_fks_before) IS DISTINCT FROM (SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY id)::text,'')) FROM public.app_accounts r)
 OR (SELECT auth FROM native_customer_fks_before) IS DISTINCT FROM (SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY id)::text,'')) FROM auth.users r)
 THEN RAISE EXCEPTION 'Customer FK operation changed existing rows'; END IF;
END $unchanged$;
COMMIT;
