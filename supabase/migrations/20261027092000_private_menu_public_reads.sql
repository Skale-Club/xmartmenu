-- EX-06: a private menu's content is not readable with the public anon key.
--
-- The public read policies on the catalog only looked at availability
-- (products.is_available, categories.is_active) or allowed everything
-- (option groups, options, product ingredients, product media: USING true).
-- Anyone could therefore read an "exclusive" menu, its in-store prices and
-- options straight through PostgREST, whatever the pages hid. The app reads
-- the public menu with the service role, so these policies only decide what
-- the anon key (and signed-in end users) can see directly.
--
-- Public now means: available row, on an active, non-private menu of an active
-- restaurant. Members of the restaurant (and superadmins) still read all of
-- their own catalog, as before.

CREATE OR REPLACE FUNCTION public.menu_is_public(p_menu_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_menu_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.menus m
    JOIN public.tenants t ON t.id = m.tenant_id
    WHERE m.id = p_menu_id
      AND m.is_active
      AND m.is_private IS NOT TRUE
      AND t.is_active
  );
$$;

CREATE OR REPLACE FUNCTION public.product_is_public(p_product_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = p_product_id
      AND p.is_available
      AND public.menu_is_public(p.menu_id)
  );
$$;

-- Used inside policies, so the callers' roles must be able to run them.
REVOKE EXECUTE ON FUNCTION public.menu_is_public(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.product_is_public(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.menu_is_public(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.product_is_public(UUID) TO anon, authenticated, service_role;

-- Policy names differ between production and a database built from these
-- migrations (production was edited by hand: products_select there,
-- products_public / products_tenant_read here). Permissive policies add up,
-- so any leftover read policy would keep the leak open. Drop every SELECT
-- policy on these tables, whatever its name, then create the one below.
-- (ALL policies are write policies of members/managers and stay.)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public'
      AND cmd = 'SELECT'
      AND tablename IN ('categories', 'products', 'product_option_groups', 'product_options', 'product_ingredients', 'product_media')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "categories_select" ON public.categories;
CREATE POLICY "categories_select" ON public.categories FOR SELECT
  USING (
    tenant_id = public.auth_tenant_id()
    OR public.is_superadmin()
    OR (is_active AND public.menu_is_public(menu_id))
  );

DROP POLICY IF EXISTS "products_select" ON public.products;
CREATE POLICY "products_select" ON public.products FOR SELECT
  USING (
    tenant_id = public.auth_tenant_id()
    OR public.is_superadmin()
    OR (is_available AND public.menu_is_public(menu_id))
  );

DROP POLICY IF EXISTS "option_groups_public_read" ON public.product_option_groups;
CREATE POLICY "option_groups_public_read" ON public.product_option_groups FOR SELECT
  USING (
    tenant_id = public.auth_tenant_id()
    OR public.is_superadmin()
    OR public.product_is_public(product_id)
  );

DROP POLICY IF EXISTS "options_public_read" ON public.product_options;
CREATE POLICY "options_public_read" ON public.product_options FOR SELECT
  USING (
    tenant_id = public.auth_tenant_id()
    OR public.is_superadmin()
    OR EXISTS (
      SELECT 1 FROM public.product_option_groups g
      WHERE g.id = product_options.group_id
        AND public.product_is_public(g.product_id)
    )
  );

DROP POLICY IF EXISTS "Public read product_ingredients" ON public.product_ingredients;
CREATE POLICY "Public read product_ingredients" ON public.product_ingredients FOR SELECT
  USING (
    tenant_id = public.auth_tenant_id()
    OR public.is_superadmin()
    OR public.product_is_public(product_id)
  );

DROP POLICY IF EXISTS "product_media_public_read" ON public.product_media;
CREATE POLICY "product_media_public_read" ON public.product_media FOR SELECT
  USING (
    tenant_id = public.auth_tenant_id()
    OR public.is_superadmin()
    OR public.product_is_public(product_id)
  );
