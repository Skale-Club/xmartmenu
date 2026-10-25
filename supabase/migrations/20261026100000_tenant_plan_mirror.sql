-- tenants.plan follows the restaurant's subscription plan.
--
-- The column predates the plans table and only accepted free/pro/enterprise,
-- while plans are now menu/orders/payments. Creating a restaurant (which
-- writes the plan slug) failed on that check, and changing a plan left the
-- column stale. Now it is a plain mirror of plans.slug, kept in sync by a
-- trigger on tenant_subscriptions, whatever path changes the plan (superadmin,
-- Stripe webhooks, SQL).

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.tenants'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%plan%'
  LOOP
    EXECUTE format('ALTER TABLE public.tenants DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.tenants ALTER COLUMN plan SET DEFAULT 'menu';

UPDATE public.tenants t
SET plan = p.slug
FROM public.tenant_subscriptions s
JOIN public.plans p ON p.id = s.plan_id
WHERE s.tenant_id = t.id AND t.plan IS DISTINCT FROM p.slug;

CREATE OR REPLACE FUNCTION public.mirror_tenant_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE slug TEXT;
BEGIN
  IF NEW.plan_id IS NULL THEN RETURN NEW; END IF;
  SELECT p.slug INTO slug FROM public.plans p WHERE p.id = NEW.plan_id;
  IF slug IS NOT NULL THEN
    UPDATE public.tenants SET plan = slug WHERE id = NEW.tenant_id AND plan IS DISTINCT FROM slug;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.mirror_tenant_plan() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS mirror_tenant_plan ON public.tenant_subscriptions;
CREATE TRIGGER mirror_tenant_plan
  AFTER INSERT OR UPDATE OF plan_id ON public.tenant_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.mirror_tenant_plan();
