-- =============================================================================
-- Local / CI seed — loaded by `supabase db reset` (and `supabase start`) after
-- the migrations. NEVER run against production: it creates users with known
-- test passwords.
--
-- Three restaurants, one per plan, so tests can prove the plan rules:
--   test-menu    Digital Menu     menu only (switches are ON to prove the plan wins)
--   test-waiter  Menu + Orders    waiter app
--   test-self    Menu + Payments  guests order and pay; upsell; table links
--   test-switch  Menu + Payments  only for tests that flip the restaurant switches,
--                                 so they never disturb the other tests
--
-- Every id is fixed and mirrored in tests/e2e/fixtures/seed.ts.
-- Logins (password for all: Test-Pass-1234!):
--   owner@test-menu.local, owner@test-waiter.local, staff@test-waiter.local,
--   owner@test-self.local,  staff@test-self.local,  staff@test-switch.local,
--   superadmin@test.local (platform superadmin, no restaurant)
-- =============================================================================

-- ── Users ────────────────────────────────────────────────────────────────────
-- GoTrue needs the token columns as '' (not NULL) and an email identity.
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
SELECT
  '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
  extensions.crypt('Test-Pass-1234!', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', u.full_name), now(), now(), '', '', '', ''
FROM (VALUES
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'owner@test-menu.local',   'Menu Owner'),
  ('a0000000-0000-4000-8000-000000000002'::uuid, 'owner@test-waiter.local', 'Waiter Owner'),
  ('a0000000-0000-4000-8000-000000000003'::uuid, 'staff@test-waiter.local', 'Waiter Staff'),
  ('a0000000-0000-4000-8000-000000000004'::uuid, 'owner@test-self.local',   'Self Owner'),
  ('a0000000-0000-4000-8000-000000000005'::uuid, 'staff@test-self.local',   'Self Staff'),
  ('a0000000-0000-4000-8000-000000000006'::uuid, 'staff@test-switch.local', 'Switch Staff'),
  ('a0000000-0000-4000-8000-000000000007'::uuid, 'superadmin@test.local',   'Test Superadmin')
) AS u(id, email, full_name);

INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
SELECT gen_random_uuid(), u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now()
FROM auth.users u
WHERE u.email LIKE '%@test-%.local' OR u.email = 'superadmin@test.local';

-- ── Restaurants ──────────────────────────────────────────────────────────────
INSERT INTO public.tenants (id, slug, name, is_active) VALUES
  ('b0000000-0000-4000-8000-000000000001', 'test-menu',   'Test Menu Only',   true),
  ('b0000000-0000-4000-8000-000000000002', 'test-waiter', 'Test Waiter Bistro', true),
  ('b0000000-0000-4000-8000-000000000003', 'test-self',   'Test Self Service', true),
  ('b0000000-0000-4000-8000-000000000004', 'test-switch', 'Test Switches', true);

INSERT INTO public.tenant_settings (
  tenant_id, currency, language, orders_enabled, direct_orders_enabled, table_management_enabled,
  dine_in_enabled, pickup_enabled, delivery_enabled, analytics_enabled, visual_feed_enabled,
  menu_default_view, upsell_enabled, item_notes_enabled
)
SELECT id, 'BRL', 'en', true, true, true, true, true, false, true, false, 'list', true, true
FROM public.tenants WHERE slug LIKE 'test-%';

INSERT INTO public.tenant_subscriptions (tenant_id, plan_id, billing_cycle, status) VALUES
  ('b0000000-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111', 'monthly', 'active'),
  ('b0000000-0000-4000-8000-000000000002', '22222222-2222-2222-2222-222222222222', 'monthly', 'active'),
  ('b0000000-0000-4000-8000-000000000003', '33333333-3333-3333-3333-333333333333', 'monthly', 'active'),
  ('b0000000-0000-4000-8000-000000000004', '33333333-3333-3333-3333-333333333333', 'monthly', 'active');

-- handle_new_user() created bare profiles; give them a restaurant and a role.
UPDATE public.profiles p SET tenant_id = v.tenant_id, role = v.role, must_change_password = false
FROM (VALUES
  ('a0000000-0000-4000-8000-000000000001'::uuid, 'b0000000-0000-4000-8000-000000000001'::uuid, 'store-admin'),
  ('a0000000-0000-4000-8000-000000000002'::uuid, 'b0000000-0000-4000-8000-000000000002'::uuid, 'store-admin'),
  ('a0000000-0000-4000-8000-000000000003'::uuid, 'b0000000-0000-4000-8000-000000000002'::uuid, 'store-staff'),
  ('a0000000-0000-4000-8000-000000000004'::uuid, 'b0000000-0000-4000-8000-000000000003'::uuid, 'store-admin'),
  ('a0000000-0000-4000-8000-000000000005'::uuid, 'b0000000-0000-4000-8000-000000000003'::uuid, 'store-staff'),
  ('a0000000-0000-4000-8000-000000000006'::uuid, 'b0000000-0000-4000-8000-000000000004'::uuid, 'store-staff')
) AS v(id, tenant_id, role)
WHERE p.id = v.id;

UPDATE public.profiles SET role = 'superadmin', tenant_id = NULL, must_change_password = false
WHERE id = 'a0000000-0000-4000-8000-000000000007';

-- ── Menus ────────────────────────────────────────────────────────────────────
INSERT INTO public.menus (id, tenant_id, name, slug, language, supported_languages, is_active, is_default) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'Main Menu', 'main', 'en', ARRAY['en','pt'], true, true),
  ('c0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'Main Menu', 'main', 'en', ARRAY['en','pt'], true, true),
  ('c0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000003', 'Main Menu', 'main', 'en', ARRAY['en','pt'], true, true),
  ('c0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000004', 'Main Menu', 'main', 'en', ARRAY['en','pt'], true, true);

-- Same three categories everywhere; course drives "Complete your order".
INSERT INTO public.categories (id, tenant_id, menu_id, name, position, is_active, course)
SELECT ('d0000000-0000-4000-8000-000000000' || t.n || c.n)::uuid, t.tenant_id, t.menu_id, c.name, c.pos, true, c.course
FROM (VALUES
  ('01', 'b0000000-0000-4000-8000-000000000001'::uuid, 'c0000000-0000-4000-8000-000000000001'::uuid),
  ('02', 'b0000000-0000-4000-8000-000000000002'::uuid, 'c0000000-0000-4000-8000-000000000002'::uuid),
  ('03', 'b0000000-0000-4000-8000-000000000003'::uuid, 'c0000000-0000-4000-8000-000000000003'::uuid),
  ('04', 'b0000000-0000-4000-8000-000000000004'::uuid, 'c0000000-0000-4000-8000-000000000004'::uuid)
) AS t(n, tenant_id, menu_id)
CROSS JOIN (VALUES
  ('1', 'Mains', 0, 'main'),
  ('2', 'Drinks', 1, 'drink'),
  ('3', 'Desserts', 2, 'dessert')
) AS c(n, name, pos, course);

-- Products: e0..0<tenant><product>. Steak has a required size, so it can't be
-- quick-added and must open its details.
INSERT INTO public.products (id, tenant_id, menu_id, category_id, name, description, price, position, is_available, is_featured)
SELECT
  ('e0000000-0000-4000-8000-000000000' || t.n || p.n)::uuid, t.tenant_id, t.menu_id,
  ('d0000000-0000-4000-8000-000000000' || t.n || p.cat)::uuid,
  p.name, p.description, p.price, p.pos, true, p.featured
FROM (VALUES
  ('01', 'b0000000-0000-4000-8000-000000000001'::uuid, 'c0000000-0000-4000-8000-000000000001'::uuid),
  ('02', 'b0000000-0000-4000-8000-000000000002'::uuid, 'c0000000-0000-4000-8000-000000000002'::uuid),
  ('03', 'b0000000-0000-4000-8000-000000000003'::uuid, 'c0000000-0000-4000-8000-000000000003'::uuid),
  ('04', 'b0000000-0000-4000-8000-000000000004'::uuid, 'c0000000-0000-4000-8000-000000000004'::uuid)
) AS t(n, tenant_id, menu_id)
CROSS JOIN (VALUES
  ('1', '1', 'Classic Burger', 'Beef patty, cheddar, pickles', 20.00, 0, false),
  ('2', '1', 'Ribeye Steak',   'Grilled ribeye with fries',    45.00, 1, false),
  ('3', '2', 'Cola',           'Chilled 350ml can',             5.00, 0, false),
  ('4', '2', 'Orange Juice',   'Freshly squeezed',              7.00, 1, true),
  ('5', '3', 'Brownie',        'Warm chocolate brownie',        9.00, 0, false)
) AS p(n, cat, name, description, price, pos, featured);

INSERT INTO public.product_option_groups (id, product_id, tenant_id, name, type, required, min_selections, max_selections, price_rule, position)
SELECT ('f0000000-0000-4000-8000-000000000' || t.n || '1')::uuid, ('e0000000-0000-4000-8000-000000000' || t.n || '2')::uuid, t.tenant_id,
       'Size', 'single', true, 1, 1, 'sum', 0
FROM (VALUES ('01', 'b0000000-0000-4000-8000-000000000001'::uuid), ('02', 'b0000000-0000-4000-8000-000000000002'::uuid), ('03', 'b0000000-0000-4000-8000-000000000003'::uuid), ('04', 'b0000000-0000-4000-8000-000000000004'::uuid)) AS t(n, tenant_id);

-- Options f1..0<tenant><n>: 1 = Regular (+0), 2 = Large (+10.00).
INSERT INTO public.product_options (id, group_id, tenant_id, name, price_modifier, position, is_available)
SELECT ('f1000000-0000-4000-8000-000000000' || t.n || o.n)::uuid, ('f0000000-0000-4000-8000-000000000' || t.n || '1')::uuid, t.tenant_id, o.name, o.modifier, o.pos, true
FROM (VALUES ('01', 'b0000000-0000-4000-8000-000000000001'::uuid), ('02', 'b0000000-0000-4000-8000-000000000002'::uuid), ('03', 'b0000000-0000-4000-8000-000000000003'::uuid), ('04', 'b0000000-0000-4000-8000-000000000004'::uuid)) AS t(n, tenant_id)
CROSS JOIN (VALUES ('1', 'Regular', 0.00, 0), ('2', 'Large', 10.00, 1)) AS o(n, name, modifier, pos);

-- ── Tables ───────────────────────────────────────────────────────────────────
INSERT INTO public.restaurant_tables (id, tenant_id, name, position, is_active) VALUES
  ('a1000000-0000-4000-8000-000000000021', 'b0000000-0000-4000-8000-000000000002', 'Mesa 1', 0, true),
  ('a1000000-0000-4000-8000-000000000034', 'b0000000-0000-4000-8000-000000000003', 'Mesa 4', 0, true),
  ('a1000000-0000-4000-8000-000000000035', 'b0000000-0000-4000-8000-000000000003', 'Mesa 5', 1, true),
  ('a1000000-0000-4000-8000-000000000039', 'b0000000-0000-4000-8000-000000000003', 'Old Patio', 2, false),
  ('a1000000-0000-4000-8000-000000000049', 'b0000000-0000-4000-8000-000000000004', 'Mesa 9', 0, true);

-- Storage buckets the app uploads to (production uses Cloudflare R2; local and
-- CI use Supabase Storage). Dish photos and videos go to product-images.
INSERT INTO storage.buckets (id, name, public) VALUES
  ('product-images', 'product-images', true),
  ('tenant-assets', 'tenant-assets', true)
ON CONFLICT (id) DO NOTHING;

-- ── Private menu (EX-06) ─────────────────────────────────────────────────────
-- test-private: digital menu plan, its only (default) menu is private. Nothing
-- of it may reach a visitor without a phone-verified session: not the page,
-- the JSON API, the JSON-LD nor a direct read with the anon key.
INSERT INTO public.tenants (id, slug, name, is_active) VALUES
  ('b0000000-0000-4000-8000-000000000005', 'test-private', 'Test Private Club', true);

INSERT INTO public.tenant_settings (tenant_id, currency, language, menu_default_view)
VALUES ('b0000000-0000-4000-8000-000000000005', 'BRL', 'en', 'list');

INSERT INTO public.tenant_subscriptions (tenant_id, plan_id, billing_cycle, status) VALUES
  ('b0000000-0000-4000-8000-000000000005', '11111111-1111-1111-1111-111111111111', 'monthly', 'active');

INSERT INTO public.menus (id, tenant_id, name, slug, language, supported_languages, is_active, is_default, is_private) VALUES
  ('c0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000005', 'Members Menu', 'members', 'en', ARRAY['en'], true, true, true);

INSERT INTO public.categories (id, tenant_id, menu_id, name, position, is_active) VALUES
  ('d0000000-0000-4000-8000-000000000051', 'b0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000005', 'Members Only Section', 0, true);

INSERT INTO public.products (id, tenant_id, menu_id, category_id, name, description, price, position, is_available, is_featured) VALUES
  ('e0000000-0000-4000-8000-000000000051', 'b0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000005',
   'd0000000-0000-4000-8000-000000000051', 'Secret Wagyu', 'Members only', 199.00, 0, true, false);

INSERT INTO public.product_option_groups (id, product_id, tenant_id, name, type, required, min_selections, max_selections, price_rule, position) VALUES
  ('f0000000-0000-4000-8000-000000000051', 'e0000000-0000-4000-8000-000000000051', 'b0000000-0000-4000-8000-000000000005', 'Secret Doneness', 'single', true, 1, 1, 'sum', 0);

INSERT INTO public.product_options (id, group_id, tenant_id, name, price_modifier, position, is_available) VALUES
  ('f1000000-0000-4000-8000-000000000051', 'f0000000-0000-4000-8000-000000000051', 'b0000000-0000-4000-8000-000000000005', 'Secret Rare', 0.00, 0, true);

-- ── Custom domain (EX-05) ────────────────────────────────────────────────────
-- test-domain answers on menu.test-domain.test (sent as the Host header by the
-- e2e tests): its pages at the root, platform routes (API, checkout) global.
INSERT INTO public.tenants (id, slug, name, is_active, custom_domain, custom_domain_verified) VALUES
  ('b0000000-0000-4000-8000-000000000006', 'test-domain', 'Test Custom Domain', true, 'menu.test-domain.test', true);

INSERT INTO public.tenant_settings (tenant_id, currency, language, menu_default_view)
VALUES ('b0000000-0000-4000-8000-000000000006', 'BRL', 'en', 'list');

INSERT INTO public.tenant_subscriptions (tenant_id, plan_id, billing_cycle, status) VALUES
  ('b0000000-0000-4000-8000-000000000006', '11111111-1111-1111-1111-111111111111', 'monthly', 'active');

INSERT INTO public.menus (id, tenant_id, name, slug, language, supported_languages, is_active, is_default) VALUES
  ('c0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000006', 'Domain Menu', 'main', 'en', ARRAY['en'], true, true);

INSERT INTO public.categories (id, tenant_id, menu_id, name, position, is_active) VALUES
  ('d0000000-0000-4000-8000-000000000061', 'b0000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000006', 'Domain Specials', 0, true);

INSERT INTO public.products (id, tenant_id, menu_id, category_id, name, description, price, position, is_available, is_featured) VALUES
  ('e0000000-0000-4000-8000-000000000061', 'b0000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000006',
   'd0000000-0000-4000-8000-000000000061', 'Domain Burger', 'Served on its own domain', 30.00, 0, true, false);
