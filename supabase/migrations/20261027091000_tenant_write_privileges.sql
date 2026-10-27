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
-- Reads are unchanged: members keep SELECT on everything they saw before.

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

-- ─── catalog: categories, products ───────────────────────────────────────────

DROP POLICY IF EXISTS "categories_insert" ON public.categories;
DROP POLICY IF EXISTS "categories_update" ON public.categories;
DROP POLICY IF EXISTS "categories_delete" ON public.categories;
CREATE POLICY "categories_insert" ON public.categories FOR INSERT TO authenticated
  WITH CHECK (public.auth_can_manage_tenant(tenant_id));
CREATE POLICY "categories_update" ON public.categories FOR UPDATE TO authenticated
  USING (public.auth_can_manage_tenant(tenant_id))
  WITH CHECK (public.auth_can_manage_tenant(tenant_id));
CREATE POLICY "categories_delete" ON public.categories FOR DELETE TO authenticated
  USING (public.auth_can_manage_tenant(tenant_id));

DROP POLICY IF EXISTS "products_insert" ON public.products;
DROP POLICY IF EXISTS "products_update" ON public.products;
DROP POLICY IF EXISTS "products_delete" ON public.products;
CREATE POLICY "products_insert" ON public.products FOR INSERT TO authenticated
  WITH CHECK (public.auth_can_manage_tenant(tenant_id));
CREATE POLICY "products_update" ON public.products FOR UPDATE TO authenticated
  USING (public.auth_can_manage_tenant(tenant_id))
  WITH CHECK (public.auth_can_manage_tenant(tenant_id));
CREATE POLICY "products_delete" ON public.products FOR DELETE TO authenticated
  USING (public.auth_can_manage_tenant(tenant_id));

-- ─── catalog children with a public read policy already ──────────────────────

DROP POLICY IF EXISTS "option_groups_admin" ON public.product_option_groups;
CREATE POLICY "option_groups_admin" ON public.product_option_groups FOR ALL TO authenticated
  USING (public.auth_can_manage_tenant(tenant_id))
  WITH CHECK (public.auth_can_manage_tenant(tenant_id));

DROP POLICY IF EXISTS "options_admin" ON public.product_options;
CREATE POLICY "options_admin" ON public.product_options FOR ALL TO authenticated
  USING (public.auth_can_manage_tenant(tenant_id))
  WITH CHECK (public.auth_can_manage_tenant(tenant_id));

DROP POLICY IF EXISTS "Tenant members manage product_ingredients" ON public.product_ingredients;
CREATE POLICY "Tenant members manage product_ingredients" ON public.product_ingredients FOR ALL TO authenticated
  USING (public.auth_can_manage_tenant(tenant_id))
  WITH CHECK (public.auth_can_manage_tenant(tenant_id));

DROP POLICY IF EXISTS "product_media_tenant_write" ON public.product_media;
CREATE POLICY "product_media_tenant_write" ON public.product_media FOR ALL TO authenticated
  USING (public.auth_can_manage_tenant(tenant_id))
  WITH CHECK (public.auth_can_manage_tenant(tenant_id));

-- ─── tables where members also need to read unpublished rows ────────────────
-- Pattern: the old member policy becomes SELECT-only, a manager policy covers
-- writes.

-- ingredients
DROP POLICY IF EXISTS "Tenant members manage ingredients" ON public.ingredients;
CREATE POLICY "Tenant members read ingredients" ON public.ingredients FOR SELECT TO authenticated
  USING (tenant_id = public.auth_tenant_id() OR public.is_superadmin());
CREATE POLICY "Tenant managers manage ingredients" ON public.ingredients FOR ALL TO authenticated
  USING (public.auth_can_manage_tenant(tenant_id))
  WITH CHECK (public.auth_can_manage_tenant(tenant_id));

-- menus
DROP POLICY IF EXISTS "Tenant members manage menus" ON public.menus;
CREATE POLICY "Tenant members read menus" ON public.menus FOR SELECT TO authenticated
  USING (tenant_id = public.auth_tenant_id() OR public.is_superadmin());
CREATE POLICY "Tenant managers manage menus" ON public.menus FOR ALL TO authenticated
  USING (public.auth_can_manage_tenant(tenant_id))
  WITH CHECK (public.auth_can_manage_tenant(tenant_id));

-- delivery_zones
DROP POLICY IF EXISTS "delivery_zones_admin" ON public.delivery_zones;
CREATE POLICY "delivery_zones_member_read" ON public.delivery_zones FOR SELECT TO authenticated
  USING (tenant_id = public.auth_tenant_id() OR public.is_superadmin());
CREATE POLICY "delivery_zones_manage" ON public.delivery_zones FOR ALL TO authenticated
  USING (public.auth_can_manage_tenant(tenant_id))
  WITH CHECK (public.auth_can_manage_tenant(tenant_id));

-- locations (members keep locations_select_own)
DROP POLICY IF EXISTS "locations_insert_own" ON public.locations;
DROP POLICY IF EXISTS "locations_update_own" ON public.locations;
DROP POLICY IF EXISTS "locations_delete_own" ON public.locations;
CREATE POLICY "locations_insert_own" ON public.locations FOR INSERT TO authenticated
  WITH CHECK (public.auth_can_manage_tenant(tenant_id));
CREATE POLICY "locations_update_own" ON public.locations FOR UPDATE TO authenticated
  USING (public.auth_can_manage_tenant(tenant_id))
  WITH CHECK (public.auth_can_manage_tenant(tenant_id));
CREATE POLICY "locations_delete_own" ON public.locations FOR DELETE TO authenticated
  USING (public.auth_can_manage_tenant(tenant_id));

-- qr_codes
DROP POLICY IF EXISTS "qrcodes_admin" ON public.qr_codes;
CREATE POLICY "qrcodes_member_read" ON public.qr_codes FOR SELECT TO authenticated
  USING (tenant_id = public.auth_tenant_id() OR public.is_superadmin());
CREATE POLICY "qrcodes_admin" ON public.qr_codes FOR ALL TO authenticated
  USING (public.auth_can_manage_tenant(tenant_id))
  WITH CHECK (public.auth_can_manage_tenant(tenant_id));

-- restaurant_tables (the waiter app reads them)
DROP POLICY IF EXISTS "restaurant_tables_tenant_all" ON public.restaurant_tables;
CREATE POLICY "restaurant_tables_member_read" ON public.restaurant_tables FOR SELECT TO authenticated
  USING (tenant_id = public.auth_tenant_id() OR public.is_superadmin());
CREATE POLICY "restaurant_tables_manage" ON public.restaurant_tables FOR ALL TO authenticated
  USING (public.auth_can_manage_tenant(tenant_id))
  WITH CHECK (public.auth_can_manage_tenant(tenant_id));

-- tenant_settings (settings_superadmin stays)
DROP POLICY IF EXISTS "settings_self" ON public.tenant_settings;
CREATE POLICY "settings_member_read" ON public.tenant_settings FOR SELECT TO authenticated
  USING (tenant_id = public.auth_tenant_id());
CREATE POLICY "settings_manage" ON public.tenant_settings FOR ALL TO authenticated
  USING (public.auth_can_manage_tenant(tenant_id))
  WITH CHECK (public.auth_can_manage_tenant(tenant_id));

-- chat add-on settings and blocked phones
DROP POLICY IF EXISTS "chat_addon_settings_tenant_all" ON public.chat_addon_settings;
CREATE POLICY "chat_addon_settings_member_read" ON public.chat_addon_settings FOR SELECT TO authenticated
  USING (tenant_id = public.auth_tenant_id() OR public.is_superadmin());
CREATE POLICY "chat_addon_settings_manage" ON public.chat_addon_settings FOR ALL TO authenticated
  USING (public.auth_can_manage_tenant(tenant_id))
  WITH CHECK (public.auth_can_manage_tenant(tenant_id));

DROP POLICY IF EXISTS "chat_blocked_phones_tenant_all" ON public.chat_blocked_phones;
CREATE POLICY "chat_blocked_phones_member_read" ON public.chat_blocked_phones FOR SELECT TO authenticated
  USING (tenant_id = public.auth_tenant_id() OR public.is_superadmin());
CREATE POLICY "chat_blocked_phones_manage" ON public.chat_blocked_phones FOR ALL TO authenticated
  USING (public.auth_can_manage_tenant(tenant_id))
  WITH CHECK (public.auth_can_manage_tenant(tenant_id));

-- ─── chat: no direct inserts; updates by managers only ──────────────────────

DROP POLICY IF EXISTS "chat_conversations_public_insert" ON public.chat_conversations;
DROP POLICY IF EXISTS "chat_messages_public_insert" ON public.chat_messages;
DROP POLICY IF EXISTS "chat_conversations_tenant_update" ON public.chat_conversations;
CREATE POLICY "chat_conversations_tenant_update" ON public.chat_conversations FOR UPDATE TO authenticated
  USING (public.auth_can_manage_tenant(tenant_id))
  WITH CHECK (public.auth_can_manage_tenant(tenant_id));

-- ─── orders: read by members, written only by the server ────────────────────

DROP POLICY IF EXISTS "orders_tenant_admin" ON public.orders;
CREATE POLICY "orders_tenant_read" ON public.orders FOR SELECT TO authenticated
  USING (tenant_id = public.auth_tenant_id() OR public.is_superadmin());

DROP POLICY IF EXISTS "order_items_admin" ON public.order_items;
CREATE POLICY "order_items_tenant_read" ON public.order_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_items.order_id
      AND (o.tenant_id = public.auth_tenant_id() OR public.is_superadmin())
  ));
