-- Seed data for user xkedulesc@gmail.com
-- Run this SQL in Supabase SQL Editor

-- First, get or create the user's profile
-- Note: The user must sign up first, then run this to add test data

-- Variables (replace with actual user ID after signup)
-- For testing, we'll use a deterministic tenant slug

DO $$
DECLARE
    v_user_id UUID;
    v_tenant_id UUID;
    v_menu_id UUID;
    v_cat1_id UUID;
    v_cat2_id UUID;
    v_cat3_id UUID;
    v_cat4_id UUID;
    v_product_id UUID;
    v_qr_id UUID;
    v_settings_id UUID;
BEGIN
    -- Find user by email
    SELECT id INTO v_user_id FROM auth.users WHERE email = 'xkedulesc@gmail.com';
    
    IF v_user_id IS NULL THEN
        RAISE NOTICE 'User xkedulesc@gmail.com not found. Please sign up first.';
        RETURN;
    END IF;
    
    -- Check if tenant already exists for this user
    SELECT tenant_id INTO v_tenant_id FROM profiles WHERE id = v_user_id;
    
    -- Create tenant if not exists
    IF v_tenant_id IS NULL THEN
        INSERT INTO tenants (slug, name, plan, is_active)
        VALUES ('restaurante-teste', 'Restaurante Teste', 'pro', true)
        RETURNING id INTO v_tenant_id;
        
        -- Update profile with tenant
        UPDATE profiles SET tenant_id = v_tenant_id WHERE id = v_user_id;
        
        RAISE NOTICE 'Created tenant: %', v_tenant_id;
    ELSE
        RAISE NOTICE 'Using existing tenant: %', v_tenant_id;
    END IF;
    
    -- Create tenant settings if not exists
    INSERT INTO tenant_settings (tenant_id, logo_url, primary_color, accent_color, banner_url, address, phone, instagram, whatsapp, currency, language, orders_enabled, whatsapp_orders_enabled, custom_tags, business_hours)
    VALUES (
        v_tenant_id,
        'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=400',
        '#1a1a2e',
        '#e94560',
        'https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=1200',
        'Rua das Flores, 123 - Centro, São Paulo - SP',
        '(11) 99999-8888',
        '@restauranteteste',
        '5511999998888',
        'BRL',
        'pt',
        true,
        true,
        ARRAY['Vegetariano', 'Vegano', 'Sem Glúten', 'Picante', 'Destaque do chef', 'Recomendado', 'Novidade'],
        '{"mon": "11:00 - 23:00", "tue": "11:00 - 23:00", "wed": "11:00 - 23:00", "thu": "11:00 - 23:00", "fri": "11:00 - 00:00", "sat": "12:00 - 00:00", "sun": "12:00 - 22:00"}'::jsonb
    )
    ON CONFLICT (tenant_id) DO UPDATE SET
        logo_url = EXCLUDED.logo_url,
        primary_color = EXCLUDED.primary_color,
        accent_color = EXCLUDED.accent_color,
        banner_url = EXCLUDED.banner_url,
        address = EXCLUDED.address,
        phone = EXCLUDED.phone,
        instagram = EXCLUDED.instagram,
        whatsapp = EXCLUDED.whatsapp,
        currency = EXCLUDED.currency,
        language = EXCLUDED.language,
        orders_enabled = EXCLUDED.orders_enabled,
        whatsapp_orders_enabled = EXCLUDED.whatsapp_orders_enabled,
        custom_tags = EXCLUDED.custom_tags,
        business_hours = EXCLUDED.business_hours;
    
    -- Create default menu
    INSERT INTO menus (tenant_id, name, slug, description, language, supported_languages, purpose, is_active, is_default, position, translations)
    VALUES (
        v_tenant_id,
        'Cardápio Principal',
        'cardapio-principal',
        'Nosso cardápio completo com todas as delícias',
        'pt',
        ARRAY['pt', 'en', 'es'],
        'restaurant',
        true,
        true,
        0,
        '{"en": {"name": "Main Menu", "description": "Our complete menu with all delicacies"}, "es": {"name": "Menú Principal", "description": "Nuestro menú completo con todas las delicias"}}'::jsonb
    )
    ON CONFLICT (tenant_id, slug) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        supported_languages = EXCLUDED.supported_languages,
        translations = EXCLUDED.translations
    RETURNING id INTO v_menu_id;
    
    -- Create second menu (drinks)
    INSERT INTO menus (tenant_id, name, slug, description, language, supported_languages, purpose, is_active, is_default, position, translations)
    VALUES (
        v_tenant_id,
        'Carta de Bebidas',
        'carta-de-bebidas',
        'Bebidas e coquetéis especiais',
        'pt',
        ARRAY['pt', 'en'],
        'bar',
        true,
        false,
        1,
        '{"en": {"name": "Drinks Menu", "description": "Beverages and special cocktails"}}'::jsonb
    )
    ON CONFLICT (tenant_id, slug) DO NOTHING;
    
    RAISE NOTICE 'Created menus';
    
    -- Create Categories for main menu
    INSERT INTO categories (tenant_id, menu_id, name, description, position, is_active, translations)
    VALUES 
        (v_tenant_id, v_menu_id, 'Entradas', 'Porções para começar', 0, true, '{"en": {"name": "Appetizers", "description": "Starters to begin"}, "es": {"name": "Entradas", "description": "Porciones para empezar"}}'::jsonb),
        (v_tenant_id, v_menu_id, 'Pratos Principais', 'Nossos pratos mais pedidos', 1, true, '{"en": {"name": "Main Courses", "description": "Our most ordered dishes"}, "es": {"name": "Platos Principales", "description": "Nuestros platos más pedidos"}}'::jsonb),
        (v_tenant_id, v_menu_id, 'Sobremesas', 'Doces deliciosos', 2, true, '{"en": {"name": "Desserts", "description": "Delicious sweets"}, "es": {"name": "Postres", "description": "Dulces deliciosos"}}'::jsonb),
        (v_tenant_id, v_menu_id, 'Bebidas', 'Refrigerantes e sucos', 3, true, '{"en": {"name": "Beverages", "description": "Soft drinks and juices"}, "es": {"name": "Bebidas", "description": "Refrescos y jugos"}}'::jsonb)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_cat1_id;
    
    -- Get category IDs
    SELECT id INTO v_cat1_id FROM categories WHERE tenant_id = v_tenant_id AND name = 'Entradas' LIMIT 1;
    SELECT id INTO v_cat2_id FROM categories WHERE tenant_id = v_tenant_id AND name = 'Pratos Principais' LIMIT 1;
    SELECT id INTO v_cat3_id FROM categories WHERE tenant_id = v_tenant_id AND name = 'Sobremesas' LIMIT 1;
    SELECT id INTO v_cat4_id FROM categories WHERE tenant_id = v_tenant_id AND name = 'Bebidas' LIMIT 1;
    
    RAISE NOTICE 'Created categories';
    
    -- Create Products - Entradas
    INSERT INTO products (tenant_id, menu_id, category_id, name, description, price, original_price, image_url, image_urls, is_available, is_featured, tags, position, translations)
    VALUES 
        (v_tenant_id, v_menu_id, v_cat1_id, 'Bruschetta Italiana', 'Pão italiano grelhado com tomate fresco, manjericão e azeite de oliva extra virgem', 28.90, 35.00, 'https://images.unsplash.com/photo-1572695157366-5e585ab2b69f?w=500', ARRAY['https://images.unsplash.com/photo-1572695157366-5e585ab2b69f?w=500'], true, true, ARRAY['Vegetariano', 'Destaque do chef'], 0, '{"en": {"name": "Italian Bruschetta", "description": "Grilled Italian bread with fresh tomato, basil and extra virgin olive oil"}, "es": {"name": "Bruschetta Italiana", "description": "Pan italiano a la parrilla con tomate fresco, albahaca y aceite de oliva extra virgen"}}'::jsonb),
        
        (v_tenant_id, v_menu_id, v_cat1_id, 'Carpaccio de Carne', 'Finas fatias de carne bovina com rúcula, parmesão e molho de mostarda', 45.90, NULL, 'https://images.unsplash.com/photo-1544025162-d76694265947?w=500', ARRAY['https://images.unsplash.com/photo-1544025162-d76694265947?w=500'], true, false, ARRAY['Destaque do chef'], 1, '{"en": {"name": "Beef Carpaccio", "description": "Thin slices of beef with arugula, parmesan and mustard sauce"}, "es": {"name": "Carpaccio de Carne", "description": "Finas láminas de carne con rúcula, parmesano y salsa de mostaza"}}'::jsonb),
        
        (v_tenant_id, v_menu_id, v_cat1_id, 'Salada Caesar', 'Alface romana, croutons, parmesão e molho caesar tradicional', 32.00, NULL, 'https://images.unsplash.com/photo-1550304943-4f24f54ddde9?w=500', ARRAY['https://images.unsplash.com/photo-1550304943-4f24f54ddde9?w=500'], true, false, ARRAY['Vegetariano', 'Sem Glúten'], 2, '{"en": {"name": "Caesar Salad", "description": "Romaine lettuce, croutons, parmesan and traditional caesar dressing"}, "es": {"name": "Ensalada César", "description": "Lechuga romana, crutones, parmesano y aderezo césar tradicional"}}'::jsonb),
        
        (v_tenant_id, v_menu_id, v_cat1_id, 'Bolinho de Bacalhau', 'Tradicional bolinho português com bacalhau desfiado e batata (4 unidades)', 38.00, NULL, 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=500', ARRAY['https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=500'], true, true, ARRAY['Recomendado'], 3, '{"en": {"name": "Cod Fritters", "description": "Traditional Portuguese fritters with shredded cod and potato (4 units)"}, "es": {"name": "Croquetas de Bacalao", "description": "Croquetas portuguesas tradicionales con bacalao desmenuzado y papa (4 unidades)"}}'::jsonb)
    ON CONFLICT DO NOTHING;
    
    -- Create Products - Pratos Principais
    INSERT INTO products (tenant_id, menu_id, category_id, name, description, price, original_price, image_url, image_urls, is_available, is_featured, tags, position, translations)
    VALUES 
        (v_tenant_id, v_menu_id, v_cat2_id, 'Picanha Premium', 'Picanha maturada 30 dias grelhada na brasa, arroz, farofa e vinagrete', 89.90, 110.00, 'https://images.unsplash.com/photo-1594041680534-e8c8cdebd659?w=500', ARRAY['https://images.unsplash.com/photo-1594041680534-e8c8cdebd659?w=500', 'https://images.unsplash.com/photo-1558030006-450675393462?w=500'], true, true, ARRAY['Destaque do chef', 'Recomendado'], 0, '{"en": {"name": "Premium Picanha", "description": "30-day aged picanha grilled over charcoal, rice, farofa and vinaigrette"}, "es": {"name": "Picanha Premium", "description": "Picanha madurada 30 días a la parrilla sobre carbón, arroz, farofa y vinagreta"}}'::jsonb),
        
        (v_tenant_id, v_menu_id, v_cat2_id, 'Filé Mignon ao Molho Madeira', 'Filé mignon suíno com molho madeira, purê de batata e legumes salteados', 72.00, NULL, 'https://images.unsplash.com/photo-1558030006-450675393462?w=500', ARRAY['https://images.unsplash.com/photo-1558030006-450675393462?w=500'], true, false, ARRAY['Sem Glúten'], 1, '{"en": {"name": "Filet Mignon with Madeira Sauce", "description": "Pork filet mignon with madeira sauce, mashed potatoes and sautéed vegetables"}, "es": {"name": "Filete Mignon con Salsa Madeira", "description": "Filete mignon de cerdo con salsa madeira, puré de papa y verduras salteadas"}}'::jsonb),
        
        (v_tenant_id, v_menu_id, v_cat2_id, 'Salmão Grelhado', 'Salmão norueguês grelhado com crosta de ervas, legumes assados e molho de limão', 78.00, NULL, 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=500', ARRAY['https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=500'], true, true, ARRAY['Sem Glúten', 'Recomendado'], 2, '{"en": {"name": "Grilled Salmon", "description": "Norwegian salmon grilled with herb crust, roasted vegetables and lemon sauce"}, "es": {"name": "Salmón a la Parrilla", "description": "Salmón noruego a la parrilla con costra de hierbas, verduras asadas y salsa de limón"}}'::jsonb),
        
        (v_tenant_id, v_menu_id, v_cat2_id, 'Risoto de Funghi Secchi', 'Arroz arbóreo com cogumelos secchi, parmesão e trufa negra', 58.00, NULL, 'https://images.unsplash.com/photo-1476124369491-e7addf5db371?w=500', ARRAY['https://images.unsplash.com/photo-1476124369491-e7addf5db371?w=500'], true, false, ARRAY['Vegetariano'], 3, '{"en": {"name": "Porcini Risotto", "description": "Arborio rice with porcini mushrooms, parmesan and black truffle"}, "es": {"name": "Risotto de Funghi Secchi", "description": "Arroz arbóreo con hongos secchi, parmesano y trufa negra"}}'::jsonb),
        
        (v_tenant_id, v_menu_id, v_cat2_id, 'Frango à Parmegiana', 'Peito de frango empanado com molho de tomate e queijo gratinado, arroz e batata frita', 52.00, NULL, 'https://images.unsplash.com/photo-1632778149955-e80f8ceca2e8?w=500', ARRAY['https://images.unsplash.com/photo-1632778149955-e80f8ceca2e8?w=500'], true, false, ARRAY[], 4, '{"en": {"name": "Chicken Parmigiana", "description": "Breaded chicken breast with tomato sauce and gratin cheese, rice and french fries"}, "es": {"name": "Pollo a la Parmesana", "description": "Pechuga de pollo empanizada con salsa de tomate y queso gratinado, arroz y papas fritas"}}'::jsonb),
        
        (v_tenant_id, v_menu_id, v_cat2_id, 'Hambúrguer Artesanal', 'Pão brioche, blend de 180g, queijo cheddar, bacon crocante, cebola caramelizada e molho especial', 42.00, NULL, 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=500', ARRAY['https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=500'], true, false, ARRAY['Novidade'], 5, '{"en": {"name": "Artisan Burger", "description": "Brioche bun, 180g blend, cheddar cheese, crispy bacon, caramelized onion and special sauce"}, "es": {"name": "Hamburguesa Artesanal", "description": "Pan brioche, blend de 180g, queso cheddar, bacon crujiente, cebolla caramelizada y salsa especial"}}'::jsonb)
    ON CONFLICT DO NOTHING;
    
    -- Create Products - Sobremesas
    INSERT INTO products (tenant_id, menu_id, category_id, name, description, price, original_price, image_url, image_urls, is_available, is_featured, tags, position, translations)
    VALUES 
        (v_tenant_id, v_menu_id, v_cat3_id, 'Petit Gâteau', 'Bolo de chocolate com recheio cremoso, sorvete de baunilha e calda de frutas vermelhas', 28.00, NULL, 'https://images.unsplash.com/photo-1624353365286-3f8d62daad51?w=500', ARRAY['https://images.unsplash.com/photo-1624353365286-3f8d62daad51?w=500'], true, true, ARRAY['Destaque do chef'], 0, '{"en": {"name": "Chocolate Lava Cake", "description": "Chocolate cake with creamy filling, vanilla ice cream and red fruit sauce"}, "es": {"name": "Petit Gâteau", "description": "Pastel de chocolate con relleno cremoso, helado de vainilla y salsa de frutos rojos"}}'::jsonb),
        
        (v_tenant_id, v_menu_id, v_cat3_id, 'Tiramisù', 'Clássica sobremesa italiana com café, mascarpone e cacau', 26.00, NULL, 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?w=500', ARRAY['https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?w=500'], true, false, ARRAY['Vegetariano'], 1, '{"en": {"name": "Tiramisu", "description": "Classic Italian dessert with coffee, mascarpone and cocoa"}, "es": {"name": "Tiramisú", "description": "Clásico postre italiano con café, mascarpone y cacao"}}'::jsonb),
        
        (v_tenant_id, v_menu_id, v_cat3_id, 'Cheesecake de Frutas Vermelhas', 'Cheesecake cremoso com calda de frutas vermelhas frescas', 24.00, NULL, 'https://images.unsplash.com/photo-1533134242443-d4fd215305ad?w=500', ARRAY['https://images.unsplash.com/photo-1533134242443-d4fd215305ad?w=500'], true, false, ARRAY['Vegetariano', 'Sem Glúten'], 2, '{"en": {"name": "Red Fruit Cheesecake", "description": "Creamy cheesecake with fresh red fruit sauce"}, "es": {"name": "Cheesecake de Frutos Rojos", "description": "Cheesecake cremoso con salsa de frutos rojos frescos"}}'::jsonb),
        
        (v_tenant_id, v_menu_id, v_cat3_id, 'Pudim de Leite Condensado', 'Tradicional pudim brasileiro com calda de caramelo', 18.00, NULL, 'https://images.unsplash.com/photo-1528975604071-b4dc52a2d18c?w=500', ARRAY['https://images.unsplash.com/photo-1528975604071-b4dc52a2d18c?w=500'], true, false, ARRAY['Vegetariano'], 3, '{"en": {"name": "Condensed Milk Flan", "description": "Traditional Brazilian flan with caramel sauce"}, "es": {"name": "Flan de Leche Condensada", "description": "Flan brasileño tradicional con salsa de caramelo"}}'::jsonb)
    ON CONFLICT DO NOTHING;
    
    -- Create Products - Bebidas
    INSERT INTO products (tenant_id, menu_id, category_id, name, description, price, original_price, image_url, image_urls, is_available, is_featured, tags, position, translations)
    VALUES 
        (v_tenant_id, v_menu_id, v_cat4_id, 'Suco Natural de Laranja', 'Suco de laranja espremido na hora', 12.00, NULL, 'https://images.unsplash.com/photo-1621506289937-a8e4df240d0b?w=500', ARRAY['https://images.unsplash.com/photo-1621506289937-a8e4df240d0b?w=500'], true, false, ARRAY['Sem Glúten', 'Vegano'], 0, '{"en": {"name": "Fresh Orange Juice", "description": "Freshly squeezed orange juice"}, "es": {"name": "Jugo Natural de Naranja", "description": "Jugo de naranja recién exprimido"}}'::jsonb),
        
        (v_tenant_id, v_menu_id, v_cat4_id, 'Coca-Cola 350ml', 'Refrigerante Coca-Cola lata 350ml', 8.00, NULL, 'https://images.unsplash.com/photo-1554866585-cd94860890b7?w=500', ARRAY['https://images.unsplash.com/photo-1554866585-cd94860890b7?w=500'], true, false, ARRAY[], 1, '{"en": {"name": "Coca-Cola 350ml", "description": "Coca-Cola 350ml can"}, "es": {"name": "Coca-Cola 350ml", "description": "Lata de Coca-Cola 350ml"}}'::jsonb),
        
        (v_tenant_id, v_menu_id, v_cat4_id, 'Água Mineral 500ml', 'Água mineral sem gás 500ml', 6.00, NULL, 'https://images.unsplash.com/photo-1548839140-29a749e1cf4d?w=500', ARRAY['https://images.unsplash.com/photo-1548839140-29a749e1cf4d?w=500'], true, false, ARRAY['Sem Glúten', 'Vegano'], 2, '{"en": {"name": "Mineral Water 500ml", "description": "Still mineral water 500ml"}, "es": {"name": "Agua Mineral 500ml", "description": "Agua mineral sin gas 500ml"}}'::jsonb),
        
        (v_tenant_id, v_menu_id, v_cat4_id, 'Caipiroska de Limão', 'Vodka, limão, açúcar e gelo', 22.00, NULL, 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=500', ARRAY['https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=500'], true, true, ARRAY['Alcoólico'], 3, '{"en": {"name": "Lime Caipiroska", "description": "Vodka, lime, sugar and ice"}, "es": {"name": "Caipiroska de Limón", "description": "Vodka, limón, azúcar y hielo"}}'::jsonb),
        
        (v_tenant_id, v_menu_id, v_cat4_id, 'Mojito Clássico', 'Rum branco, hortelã, limão, açúcar e água com gás', 24.00, NULL, 'https://images.unsplash.com/photo-1551538827-9c037cb4f32a?w=500', ARRAY['https://images.unsplash.com/photo-1551538827-9c037cb4f32a?w=500'], true, false, ARRAY['Alcoólico'], 4, '{"en": {"name": "Classic Mojito", "description": "White rum, mint, lime, sugar and soda water"}, "es": {"name": "Mojito Clásico", "description": "Ron blanco, menta, limón, azúcar y agua con gas"}}'::jsonb)
    ON CONFLICT DO NOTHING;
    
    RAISE NOTICE 'Created products';
    
    -- Create QR Codes
    INSERT INTO qr_codes (tenant_id, label, target_url, scans)
    VALUES 
        (v_tenant_id, 'QR Mesa 1', 'https://xmartmenu.skale.club/r/restaurante-teste?table=1', 127),
        (v_tenant_id, 'QR Mesa 2', 'https://xmartmenu.skale.club/r/restaurante-teste?table=2', 89),
        (v_tenant_id, 'QR Mesa 3', 'https://xmartmenu.skale.club/r/restaurante-teste?table=3', 54),
        (v_tenant_id, 'QR Entrada', 'https://xmartmenu.skale.club/r/restaurante-teste', 342),
        (v_tenant_id, 'QR Cardápio Digital', 'https://xmartmenu.skale.club/r/restaurante-teste', 512),
        (v_tenant_id, 'QR Instagram', 'https://xmartmenu.skale.club/r/restaurante-teste?ref=instagram', 78)
    ON CONFLICT DO NOTHING;
    
    RAISE NOTICE 'Created QR codes';
    
    -- Create Staff members (additional profiles with store-staff role)
    -- Note: These users need to exist in auth.users first
    -- We'll create placeholder entries that can be linked later
    
    -- Create sample scan events
    INSERT INTO scan_events (tenant_id, qr_code_id, scanned_at, user_agent, country)
    SELECT 
        v_tenant_id,
        q.id,
        NOW() - (RANDOM() * INTERVAL '30 days'),
        CASE (RANDOM() * 4)::INT
            WHEN 0 THEN 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)'
            WHEN 1 THEN 'Mozilla/5.0 (Linux; Android 12; SM-G991B)'
            WHEN 2 THEN 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0'
            ELSE 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1'
        END,
        CASE (RANDOM() * 4)::INT
            WHEN 0 THEN 'BR'
            WHEN 1 THEN 'US'
            WHEN 2 THEN 'AR'
            ELSE 'PT'
        END
    FROM qr_codes q
    WHERE q.tenant_id = v_tenant_id
    LIMIT 100;
    
    RAISE NOTICE 'Created scan events';
    
    -- Create sample orders
    INSERT INTO orders (tenant_id, customer_name, customer_phone, status, total, created_at, updated_at)
    VALUES 
        (v_tenant_id, 'João Silva', '11988887777', 'completed', 127.80, NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days'),
        (v_tenant_id, 'Maria Santos', '11977776666', 'completed', 89.90, NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day'),
        (v_tenant_id, 'Pedro Oliveira', '11966665555', 'confirmed', 156.00, NOW() - INTERVAL '3 hours', NOW() - INTERVAL '3 hours'),
        (v_tenant_id, 'Ana Costa', '11955554444', 'pending', 72.00, NOW() - INTERVAL '30 minutes', NOW() - INTERVAL '30 minutes'),
        (v_tenant_id, 'Carlos Ferreira', '11944443333', 'pending', 98.00, NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '10 minutes')
    RETURNING id INTO v_product_id;
    
    RAISE NOTICE 'Created orders';
    
    -- Create order items for the orders
    INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, notes)
    SELECT 
        o.id,
        p.id,
        p.name,
        (RANDOM() * 3 + 1)::INT,
        p.price,
        CASE WHEN RANDOM() > 0.7 THEN 'Sem cebola' ELSE NULL END
    FROM orders o
    CROSS JOIN products p
    WHERE o.tenant_id = v_tenant_id
      AND p.tenant_id = v_tenant_id
      AND RANDOM() > 0.6
    LIMIT 20;
    
    RAISE NOTICE 'Created order items';
    
    RAISE NOTICE '=== Seed completed successfully! ===';
    RAISE NOTICE 'Tenant ID: %', v_tenant_id;
    RAISE NOTICE 'Menu ID: %', v_menu_id;
    
END $$;
