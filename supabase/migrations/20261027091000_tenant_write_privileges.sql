-- EX-01: database writes follow the same roles as the app.
--
-- The back office keeps staff read-only on the catalog, settings, tables, QR
-- codes and chat settings (canManage = role !== 'store-staff' in the pages,
-- 403 in the /api/admin routes), but the RLS policies only asked "is this
-- account in the restaurant?". A staff token could therefore rewrite prices,
-- settings or tables straight through PostgREST. Orders and order items were
-- writable by any member too, although every order write goes through the
-- server (service role): POST /api/orders, PATCH /api/orders/[id], webhooks.
-- Chat conversations/messages accepted inserts from anyone (WITH CHECK true);
-- the public chat routes write them with the service role.
--
-- Policy names differ between production (edited by hand) and a database
-- built from these migrations, and permissive policies add up: a leftover
-- write policy would keep the hole open. So for every table below, ALL write
-- policies (INSERT, UPDATE, DELETE, ALL) are dropped whatever their name and
-- replaced. SELECT-only policies (public reads) are left as they are, and
-- members get an explicit read policy, so reads are unchanged.

CREATE OR REPLACE FUNCTION public.auth_can_manage_tenant(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND (role = 'superadmin'
           OR (tenant_id = p_tenant_id AND role IN ('store-admin', 'admin')))
  );
$$;

REVOKE EXECUTE ON FUNCTION public.auth_can_manage_tenant(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auth_can_manage_tenant(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.auth_can_manage_tenant(UUID) IS
  'Restaurant manager (store-admin) of the tenant, or superadmin. Mirrors canManageTenant() in src/lib/auth/role-utils.ts.';

-- ─── drop every write policy on the restaurant tables ────────────────────────

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      AND tablename IN (
        'categories', 'products', 'product_option_groups', 'product_options',
        'product_ingredients', 'product_media', 'ingredients', 'menus',
        'delivery_zones', 'locations', 'qr_codes', 'restaurant_tables',
        'tenant_settings', 'chat_addon_settings', 'chat_blocked_phones',
        'chat_conversations', 'chat_messages', 'orders', 'order_items'
      )
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- ─── restaurant data: members read, managers write ───────────────────────────

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'categories', 'products', 'product_option_groups', 'product_options',
    'product_ingredients', 'product_media', 'ingredients', 'menus',
    'delivery_zones', 'locations', 'qr_codes', 'restaurant_tables',
    'tenant_settings', 'chat_addon_settings', 'chat_blocked_phones'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_member_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (tenant_id = public.auth_tenant_id() OR public.is_superadmin())',
      t || '_member_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_manage', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.auth_can_manage_tenant(tenant_id)) WITH CHECK (public.auth_can_manage_tenant(tenant_id))',
      t || '_manage', t);
  END LOOP;
END $$;

-- ─── chat: no direct inserts; conversation updates by managers only ─────────

CREATE POLICY "chat_conversations_tenant_update" ON public.chat_conversations FOR UPDATE TO authenticated
  USING (public.auth_can_manage_tenant(tenant_id))
  WITH CHECK (public.auth_can_manage_tenant(tenant_id));

-- ─── orders: read by members, written only by the server ────────────────────

DROP POLICY IF EXISTS "orders_tenant_read" ON public.orders;
CREATE POLICY "orders_tenant_read" ON public.orders FOR SELECT TO authenticated
  USING (tenant_id = public.auth_tenant_id() OR public.is_superadmin());

DROP POLICY IF EXISTS "order_items_tenant_read" ON public.order_items;
CREATE POLICY "order_items_tenant_read" ON public.order_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_items.order_id
      AND (o.tenant_id = public.auth_tenant_id() OR public.is_superadmin())
  ));
