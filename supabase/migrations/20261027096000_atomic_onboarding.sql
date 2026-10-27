-- EX-08: onboarding in one transaction, safe to repeat.
--
-- POST /api/onboarding wrote the tenant, its settings, the profile link, the
-- subscription, the menu, the category and the product one by one. A failure
-- after the tenant insert left an orphan restaurant (and the retry made
-- another); two concurrent submits created two restaurants; a failure after
-- the menu left a menu without category or product that the next attempt
-- reported as "already configured".
--
-- complete_onboarding() locks the account's profile, then creates or repairs
-- every missing piece and returns what exists. Calling it again (retry,
-- double submit, resume) converges to the same restaurant. CRM sync stays in
-- the API route, after commit.

CREATE OR REPLACE FUNCTION public.complete_onboarding(p_user_id UUID, p_input JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_tenant_id UUID;
  v_tenant_slug TEXT;
  v_created_tenant BOOLEAN := false;
  v_plan_id UUID;
  v_menu_id UUID;
  v_menu_slug TEXT;
  v_category_id UUID;
  v_base_slug TEXT := p_input->>'tenant_slug';
  v_attempt INT := 0;
BEGIN
  -- Serialize every onboarding of this account (double submit, retries).
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.profiles (id, full_name) VALUES (p_user_id, NULLIF(p_input->>'full_name', ''))
    RETURNING * INTO v_profile;
  END IF;
  IF v_profile.role = 'superadmin' THEN
    RAISE EXCEPTION 'superadmin accounts do not onboard' USING ERRCODE = 'P0403';
  END IF;

  v_tenant_id := v_profile.tenant_id;

  -- 1. Restaurant (slug collisions resolved by suffix, under the unique index).
  IF v_tenant_id IS NULL THEN
    LOOP
      v_tenant_slug := CASE WHEN v_attempt = 0 THEN v_base_slug
                            ELSE v_base_slug || '-' || substr(md5(random()::text), 1, 6) END;
      BEGIN
        INSERT INTO public.tenants (name, slug, plan)
        VALUES (p_input->>'company_name', v_tenant_slug, 'menu')
        RETURNING id INTO v_tenant_id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        v_attempt := v_attempt + 1;
        IF v_attempt > 5 THEN RAISE; END IF;
      END;
    END LOOP;
    v_created_tenant := true;

    UPDATE public.profiles
    SET tenant_id = v_tenant_id,
        role = 'store-admin',
        full_name = COALESCE(NULLIF(p_input->>'full_name', ''), full_name),
        phone = COALESCE(NULLIF(p_input->>'phone', ''), phone)
    WHERE id = p_user_id;
  ELSE
    SELECT slug INTO v_tenant_slug FROM public.tenants WHERE id = v_tenant_id;
  END IF;

  -- 2. Settings (created or repaired).
  INSERT INTO public.tenant_settings (tenant_id, phone, address, primary_color, accent_color)
  VALUES (v_tenant_id, NULLIF(p_input->>'phone', ''), NULLIF(p_input->>'address', ''),
          p_input->>'primary_color', p_input->>'accent_color')
  ON CONFLICT (tenant_id) DO NOTHING;

  -- 3. Subscription on the entry plan (getTenantPlan needs a row, or every gate is off).
  IF NOT EXISTS (SELECT 1 FROM public.tenant_subscriptions WHERE tenant_id = v_tenant_id) THEN
    SELECT id INTO v_plan_id FROM public.plans WHERE slug = 'menu' AND is_active LIMIT 1;
    IF v_plan_id IS NULL THEN
      RAISE EXCEPTION 'entry plan "menu" is missing' USING ERRCODE = 'P0500';
    END IF;
    INSERT INTO public.tenant_subscriptions (tenant_id, plan_id, billing_cycle, status)
    VALUES (v_tenant_id, v_plan_id, 'monthly', 'active');
  END IF;

  -- 4. First menu, category and product, unless the restaurant has a menu.
  SELECT id, slug INTO v_menu_id, v_menu_slug FROM public.menus
  WHERE tenant_id = v_tenant_id ORDER BY is_default DESC, position LIMIT 1;

  IF v_menu_id IS NULL THEN
    v_attempt := 0;
    LOOP
      v_menu_slug := CASE WHEN v_attempt = 0 THEN p_input->>'menu_slug'
                          ELSE (p_input->>'menu_slug') || '-' || substr(md5(random()::text), 1, 6) END;
      BEGIN
        INSERT INTO public.menus (tenant_id, name, slug, language, supported_languages, purpose, is_active, is_default)
        VALUES (v_tenant_id, p_input->>'menu_name', v_menu_slug, 'en', ARRAY['en'], p_input->>'menu_purpose', true, true)
        RETURNING id INTO v_menu_id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        v_attempt := v_attempt + 1;
        IF v_attempt > 5 THEN RAISE; END IF;
      END;
    END LOOP;
  END IF;

  -- The catalog of a menu left empty by an earlier failed attempt is repaired.
  IF NOT EXISTS (SELECT 1 FROM public.categories WHERE menu_id = v_menu_id) THEN
    INSERT INTO public.categories (tenant_id, menu_id, name, position, is_active)
    VALUES (v_tenant_id, v_menu_id, p_input->>'category_name', 0, true)
    RETURNING id INTO v_category_id;
  ELSE
    SELECT id INTO v_category_id FROM public.categories WHERE menu_id = v_menu_id ORDER BY position LIMIT 1;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products WHERE menu_id = v_menu_id) THEN
    INSERT INTO public.products (tenant_id, menu_id, category_id, name, price, is_available, is_featured, position)
    VALUES (v_tenant_id, v_menu_id, v_category_id, p_input->>'product_name',
            GREATEST(0, COALESCE((p_input->>'product_price')::NUMERIC, 0)), true, false, 0);
  END IF;

  RETURN jsonb_build_object(
    'tenant_id', v_tenant_id,
    'tenant_slug', v_tenant_slug,
    'menu_slug', v_menu_slug,
    'created_tenant', v_created_tenant
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_onboarding(UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_onboarding(UUID, JSONB) TO service_role;
