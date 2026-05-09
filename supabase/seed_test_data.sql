-- English-first seed data for local/demo testing.
-- Run this SQL in the Supabase SQL Editor after the demo user signs up.

DO $$
DECLARE
    v_user_id UUID;
    v_tenant_id UUID;
    v_menu_id UUID;
    v_cat_starters UUID;
    v_cat_mains UUID;
    v_cat_desserts UUID;
    v_cat_drinks UUID;
BEGIN
    SELECT id INTO v_user_id FROM auth.users WHERE email = 'xkedulesc@gmail.com';

    IF v_user_id IS NULL THEN
        RAISE NOTICE 'User xkedulesc@gmail.com not found. Please sign up first.';
        RETURN;
    END IF;

    SELECT tenant_id INTO v_tenant_id FROM profiles WHERE id = v_user_id;

    IF v_tenant_id IS NULL THEN
        INSERT INTO tenants (slug, name, plan, is_active)
        VALUES ('demo-restaurant', 'Demo Restaurant', 'pro', true)
        RETURNING id INTO v_tenant_id;

        UPDATE profiles SET tenant_id = v_tenant_id WHERE id = v_user_id;
    END IF;

    INSERT INTO tenant_settings (
        tenant_id, logo_url, primary_color, accent_color, banner_url, address,
        phone, instagram, whatsapp, currency, language, orders_enabled,
        whatsapp_orders_enabled, custom_tags, business_hours
    )
    VALUES (
        v_tenant_id,
        'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=400',
        '#1a1a2e',
        '#e94560',
        'https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=1200',
        '123 Main Street, New York, NY',
        '(555) 010-8888',
        '@demorestaurant',
        '15550108888',
        'USD',
        'en',
        true,
        true,
        ARRAY['Vegetarian', 'Vegan', 'Gluten-free', 'Spicy', 'Chef pick', 'Recommended', 'New'],
        '{"mon": "11:00 - 23:00", "tue": "11:00 - 23:00", "wed": "11:00 - 23:00", "thu": "11:00 - 23:00", "fri": "11:00 - 00:00", "sat": "12:00 - 00:00", "sun": "12:00 - 22:00"}'::jsonb
    )
    ON CONFLICT (tenant_id) DO UPDATE SET
        address = EXCLUDED.address,
        instagram = EXCLUDED.instagram,
        whatsapp = EXCLUDED.whatsapp,
        currency = EXCLUDED.currency,
        language = EXCLUDED.language,
        custom_tags = EXCLUDED.custom_tags;

    INSERT INTO menus (tenant_id, name, slug, description, language, supported_languages, purpose, is_active, is_default, position, translations)
    VALUES (
        v_tenant_id,
        'Main Menu',
        'main-menu',
        'Our complete menu with signature dishes',
        'en',
        ARRAY['en', 'es'],
        'restaurant',
        true,
        true,
        0,
        '{"es": {"name": "Menu Principal", "description": "Nuestro menu completo con platos destacados"}}'::jsonb
    )
    ON CONFLICT (tenant_id, slug) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        language = EXCLUDED.language,
        supported_languages = EXCLUDED.supported_languages,
        translations = EXCLUDED.translations
    RETURNING id INTO v_menu_id;

    INSERT INTO categories (tenant_id, menu_id, name, description, position, is_active)
    VALUES
        (v_tenant_id, v_menu_id, 'Starters', 'Small plates to begin with', 0, true),
        (v_tenant_id, v_menu_id, 'Mains', 'Our most requested dishes', 1, true),
        (v_tenant_id, v_menu_id, 'Desserts', 'Sweet finishes', 2, true),
        (v_tenant_id, v_menu_id, 'Drinks', 'Soft drinks, juices, and cocktails', 3, true)
    ON CONFLICT DO NOTHING;

    SELECT id INTO v_cat_starters FROM categories WHERE tenant_id = v_tenant_id AND name = 'Starters' LIMIT 1;
    SELECT id INTO v_cat_mains FROM categories WHERE tenant_id = v_tenant_id AND name = 'Mains' LIMIT 1;
    SELECT id INTO v_cat_desserts FROM categories WHERE tenant_id = v_tenant_id AND name = 'Desserts' LIMIT 1;
    SELECT id INTO v_cat_drinks FROM categories WHERE tenant_id = v_tenant_id AND name = 'Drinks' LIMIT 1;

    INSERT INTO products (tenant_id, menu_id, category_id, name, description, price, original_price, image_url, image_urls, is_available, is_featured, tags, position)
    VALUES
        (v_tenant_id, v_menu_id, v_cat_starters, 'Italian Bruschetta', 'Grilled Italian bread with fresh tomato, basil and extra virgin olive oil', 12.00, NULL, 'https://images.unsplash.com/photo-1572695157366-5e585ab2b69f?w=500', ARRAY['https://images.unsplash.com/photo-1572695157366-5e585ab2b69f?w=500'], true, true, ARRAY['Vegetarian', 'Chef pick'], 0),
        (v_tenant_id, v_menu_id, v_cat_starters, 'Beef Carpaccio', 'Thin slices of beef with arugula, parmesan and mustard sauce', 18.00, NULL, 'https://images.unsplash.com/photo-1544025162-d76694265947?w=500', ARRAY['https://images.unsplash.com/photo-1544025162-d76694265947?w=500'], true, false, ARRAY['Chef pick'], 1),
        (v_tenant_id, v_menu_id, v_cat_mains, 'Grilled Salmon', 'Salmon grilled with herb crust, roasted vegetables and lemon sauce', 26.00, NULL, 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=500', ARRAY['https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=500'], true, true, ARRAY['Recommended'], 0),
        (v_tenant_id, v_menu_id, v_cat_mains, 'Artisan Burger', 'Brioche bun, 180g blend, cheddar cheese, crispy bacon, caramelized onion and special sauce', 19.00, NULL, 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=500', ARRAY['https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=500'], true, false, ARRAY['New'], 1),
        (v_tenant_id, v_menu_id, v_cat_desserts, 'Chocolate Lava Cake', 'Chocolate cake with creamy filling, vanilla ice cream and red fruit sauce', 11.00, NULL, 'https://images.unsplash.com/photo-1624353365286-3f8d62daad51?w=500', ARRAY['https://images.unsplash.com/photo-1624353365286-3f8d62daad51?w=500'], true, true, ARRAY['Chef pick'], 0),
        (v_tenant_id, v_menu_id, v_cat_drinks, 'Fresh Orange Juice', 'Freshly squeezed orange juice', 6.00, NULL, 'https://images.unsplash.com/photo-1621506289937-a8e4df240d0b?w=500', ARRAY['https://images.unsplash.com/photo-1621506289937-a8e4df240d0b?w=500'], true, false, ARRAY['Vegan'], 0)
    ON CONFLICT DO NOTHING;

    INSERT INTO qr_codes (tenant_id, label, target_url, scans)
    VALUES
        (v_tenant_id, 'QR Table 1', 'https://xmartmenu.skale.club/r/demo-restaurant?table=1', 127),
        (v_tenant_id, 'QR Table 2', 'https://xmartmenu.skale.club/r/demo-restaurant?table=2', 89),
        (v_tenant_id, 'QR Entrance', 'https://xmartmenu.skale.club/r/demo-restaurant', 342),
        (v_tenant_id, 'QR Digital Menu', 'https://xmartmenu.skale.club/r/demo-restaurant', 512)
    ON CONFLICT DO NOTHING;

    INSERT INTO orders (tenant_id, customer_name, customer_phone, status, total, created_at, updated_at)
    VALUES
        (v_tenant_id, 'John Silva', '15550108888', 'completed', 38.00, NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days'),
        (v_tenant_id, 'Maria Santos', '15550107777', 'pending', 26.00, NOW() - INTERVAL '30 minutes', NOW() - INTERVAL '30 minutes')
    ON CONFLICT DO NOTHING;

    RAISE NOTICE 'English-first seed completed successfully.';
    RAISE NOTICE 'Tenant ID: %', v_tenant_id;
    RAISE NOTICE 'Menu ID: %', v_menu_id;
END $$;
