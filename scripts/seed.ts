import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !serviceKey) {
  console.error('Missing Supabase credentials')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
})

const TARGET_EMAIL = 'xkedulesc@gmail.com'

interface BusinessHours {
  mon?: string
  tue?: string
  wed?: string
  thu?: string
  fri?: string
  sat?: string
  sun?: string
}

async function seed() {
  console.log('🌱 Starting seed for user:', TARGET_EMAIL)

  // 1. Find user
  const { data: { users }, error: usersError } = await supabase.auth.admin.listUsers()
  if (usersError) {
    console.error('Error fetching users:', usersError)
    process.exit(1)
  }

  const user = users.find(u => u.email === TARGET_EMAIL)
  if (!user) {
    console.error(`User ${TARGET_EMAIL} not found. Please sign up first.`)
    process.exit(1)
  }

  console.log('✅ Found user:', user.id)

  // 2. Get tenant from profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('tenant_id')
    .eq('id', user.id)
    .single()

  let tenantId = profile?.tenant_id

  // 3. Create tenant if needed
  if (!tenantId) {
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .insert({
        slug: 'restaurante-teste',
        name: 'Restaurante Teste',
        plan: 'pro',
        is_active: true
      })
      .select()
      .single()

    if (tenantError) {
      console.error('Error creating tenant:', tenantError)
      process.exit(1)
    }

    tenantId = tenant.id

    // Update profile
    await supabase
      .from('profiles')
      .update({ tenant_id: tenantId })
      .eq('id', user.id)

    console.log('✅ Created tenant:', tenantId)
  } else {
    console.log('✅ Using existing tenant:', tenantId)
  }

  // 4. Create tenant settings
  const businessHours: BusinessHours = {
    mon: '11:00 - 23:00',
    tue: '11:00 - 23:00',
    wed: '11:00 - 23:00',
    thu: '11:00 - 23:00',
    fri: '11:00 - 00:00',
    sat: '12:00 - 00:00',
    sun: '12:00 - 22:00'
  }

  // Try with all columns first, fallback to basic columns
  let settingsError = await supabase
    .from('tenant_settings')
    .upsert({
      tenant_id: tenantId,
      logo_url: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=400',
      primary_color: '#1a1a2e',
      accent_color: '#e94560',
      banner_url: 'https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=1200',
      address: 'Rua das Flores, 123 - Centro, São Paulo - SP',
      phone: '(11) 99999-8888',
      instagram: '@restauranteteste',
      whatsapp: '5511999998888',
      orders_enabled: true,
      whatsapp_orders_enabled: true,
      custom_tags: ['Vegetariano', 'Vegano', 'Sem Glúten', 'Picante', 'Destaque do chef', 'Recomendado', 'Novidade'],
      business_hours: businessHours
    }, { onConflict: 'tenant_id' }).then(({ error }) => error)

  if (settingsError) {
    // Fallback - try with basic columns only
    settingsError = await supabase
      .from('tenant_settings')
      .upsert({
        tenant_id: tenantId,
        logo_url: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=400',
        primary_color: '#1a1a2e',
        accent_color: '#e94560',
        banner_url: 'https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=1200',
        address: 'Rua das Flores, 123 - Centro, São Paulo - SP',
        phone: '(11) 99999-8888',
        instagram: '@restauranteteste',
        whatsapp: '5511999998888',
        custom_tags: ['Vegetariano', 'Vegano', 'Sem Glúten', 'Picante', 'Destaque do chef', 'Recomendado', 'Novidade'],
        business_hours: businessHours
      }, { onConflict: 'tenant_id' }).then(({ error }) => error)
  }

  if (settingsError) {
    console.error('Error creating settings:', settingsError)
  } else {
    console.log('✅ Created tenant settings')
  }

  // 5. Create menus
  let mainMenu: { id?: string } | null = null
  let menuError = await supabase
    .from('menus')
    .upsert({
      tenant_id: tenantId,
      name: 'Cardápio Principal',
      slug: 'cardapio-principal',
      description: 'Nosso cardápio completo com todas as delícias',
      language: 'pt',
      supported_languages: ['pt', 'en', 'es'],
      purpose: 'restaurant',
      is_active: true,
      is_default: true,
      position: 0,
      translations: {
        en: { name: 'Main Menu', description: 'Our complete menu with all delicacies' },
        es: { name: 'Menú Principal', description: 'Nuestro menú completo con todas las delicias' }
      }
    }, { onConflict: 'tenant_id,slug' })
    .select()
    .single()
    .then(({ data, error }) => { mainMenu = data; return error })

  if (menuError) {
    // Fallback without newer columns
    const result = await supabase
      .from('menus')
      .upsert({
        tenant_id: tenantId,
        name: 'Cardápio Principal',
        slug: 'cardapio-principal',
        description: 'Nosso cardápio completo com todas as delícias',
        language: 'pt',
        purpose: 'restaurant',
        is_active: true,
        is_default: true,
        position: 0
      }, { onConflict: 'tenant_id,slug' })
      .select()
      .single()
    
    mainMenu = result.data
    menuError = result.error
  }

  if (menuError) {
    console.error('Error creating menu:', menuError)
  } else {
    console.log('✅ Created main menu')
  }

  // Second menu - drinks
  await supabase
    .from('menus')
    .upsert({
      tenant_id: tenantId,
      name: 'Carta de Bebidas',
      slug: 'carta-de-bebidas',
      description: 'Bebidas e coquetéis especiais',
      language: 'pt',
      purpose: 'bar',
      is_active: true,
      is_default: false,
      position: 1
    }, { onConflict: 'tenant_id,slug' })

  console.log('✅ Created drinks menu')

  const menuId = mainMenu?.id

  // 6. Create categories
  const categories = [
    { name: 'Entradas', description: 'Porções para começar', position: 0 },
    { name: 'Pratos Principais', description: 'Nossos pratos mais pedidos', position: 1 },
    { name: 'Sobremesas', description: 'Doces deliciosos', position: 2 },
    { name: 'Bebidas', description: 'Refrigerantes e sucos', position: 3 }
  ]

  const categoryIds: Record<string, string> = {}

  for (const cat of categories) {
    // First delete existing category with same name for this tenant
    await supabase
      .from('categories')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('name', cat.name)
    
    const { data, error } = await supabase
      .from('categories')
      .insert({
        tenant_id: tenantId,
        menu_id: menuId,
        name: cat.name,
        description: cat.description,
        position: cat.position,
        is_active: true
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating category:', cat.name, error)
    }
    if (data) {
      categoryIds[cat.name] = data.id
    }
  }

  console.log('✅ Created categories:', Object.keys(categoryIds))

  // 7. Create products
  const products = [
    // Entradas
    {
      category: 'Entradas',
      name: 'Bruschetta Italiana',
      description: 'Pão italiano grelhado com tomate fresco, manjericão e azeite de oliva extra virgem',
      price: 28.90,
      original_price: 35.00,
      image_url: 'https://images.unsplash.com/photo-1572695157366-5e585ab2b69f?w=500',
      is_featured: true,
      tags: ['Vegetariano', 'Destaque do chef'],
      translations: { en: { name: 'Italian Bruschetta', description: 'Grilled Italian bread with fresh tomato, basil and extra virgin olive oil' }, es: { name: 'Bruschetta Italiana', description: 'Pan italiano a la parrilla con tomate fresco, albahaca y aceite de oliva extra virgen' } }
    },
    {
      category: 'Entradas',
      name: 'Carpaccio de Carne',
      description: 'Finas fatias de carne bovina com rúcula, parmesão e molho de mostarda',
      price: 45.90,
      image_url: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=500',
      tags: ['Destaque do chef'],
      translations: { en: { name: 'Beef Carpaccio', description: 'Thin slices of beef with arugula, parmesan and mustard sauce' } }
    },
    {
      category: 'Entradas',
      name: 'Salada Caesar',
      description: 'Alface romana, croutons, parmesão e molho caesar tradicional',
      price: 32.00,
      image_url: 'https://images.unsplash.com/photo-1550304943-4f24f54ddde9?w=500',
      tags: ['Vegetariano', 'Sem Glúten'],
      translations: { en: { name: 'Caesar Salad', description: 'Romaine lettuce, croutons, parmesan and traditional caesar dressing' } }
    },
    {
      category: 'Entradas',
      name: 'Bolinho de Bacalhau',
      description: 'Tradicional bolinho português com bacalhau desfiado e batata (4 unidades)',
      price: 38.00,
      image_url: 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?w=500',
      is_featured: true,
      tags: ['Recomendado'],
      translations: { en: { name: 'Cod Fritters', description: 'Traditional Portuguese fritters with shredded cod and potato (4 units)' } }
    },
    // Pratos Principais
    {
      category: 'Pratos Principais',
      name: 'Picanha Premium',
      description: 'Picanha maturada 30 dias grelhada na brasa, arroz, farofa e vinagrete',
      price: 89.90,
      original_price: 110.00,
      image_url: 'https://images.unsplash.com/photo-1594041680534-e8c8cdebd659?w=500',
      is_featured: true,
      tags: ['Destaque do chef', 'Recomendado'],
      translations: { en: { name: 'Premium Picanha', description: '30-day aged picanha grilled over charcoal, rice, farofa and vinaigrette' } }
    },
    {
      category: 'Pratos Principais',
      name: 'Filé Mignon ao Molho Madeira',
      description: 'Filé mignon suíno com molho madeira, purê de batata e legumes salteados',
      price: 72.00,
      image_url: 'https://images.unsplash.com/photo-1558030006-450675393462?w=500',
      tags: ['Sem Glúten'],
      translations: { en: { name: 'Filet Mignon with Madeira Sauce', description: 'Pork filet mignon with madeira sauce, mashed potatoes and sautéed vegetables' } }
    },
    {
      category: 'Pratos Principais',
      name: 'Salmão Grelhado',
      description: 'Salmão norueguês grelhado com crosta de ervas, legumes assados e molho de limão',
      price: 78.00,
      image_url: 'https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=500',
      is_featured: true,
      tags: ['Sem Glúten', 'Recomendado'],
      translations: { en: { name: 'Grilled Salmon', description: 'Norwegian salmon grilled with herb crust, roasted vegetables and lemon sauce' } }
    },
    {
      category: 'Pratos Principais',
      name: 'Risoto de Funghi Secchi',
      description: 'Arroz arbóreo com cogumelos secchi, parmesão e trufa negra',
      price: 58.00,
      image_url: 'https://images.unsplash.com/photo-1476124369491-e7addf5db371?w=500',
      tags: ['Vegetariano'],
      translations: { en: { name: 'Porcini Risotto', description: 'Arborio rice with porcini mushrooms, parmesan and black truffle' } }
    },
    {
      category: 'Pratos Principais',
      name: 'Frango à Parmegiana',
      description: 'Peito de frango empanado com molho de tomate e queijo gratinado, arroz e batata frita',
      price: 52.00,
      image_url: 'https://images.unsplash.com/photo-1632778149955-e80f8ceca2e8?w=500',
      tags: [],
      translations: { en: { name: 'Chicken Parmigiana', description: 'Breaded chicken breast with tomato sauce and gratin cheese, rice and french fries' } }
    },
    {
      category: 'Pratos Principais',
      name: 'Hambúrguer Artesanal',
      description: 'Pão brioche, blend de 180g, queijo cheddar, bacon crocante, cebola caramelizada e molho especial',
      price: 42.00,
      image_url: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=500',
      tags: ['Novidade'],
      translations: { en: { name: 'Artisan Burger', description: 'Brioche bun, 180g blend, cheddar cheese, crispy bacon, caramelized onion and special sauce' } }
    },
    // Sobremesas
    {
      category: 'Sobremesas',
      name: 'Petit Gâteau',
      description: 'Bolo de chocolate com recheio cremoso, sorvete de baunilha e calda de frutas vermelhas',
      price: 28.00,
      image_url: 'https://images.unsplash.com/photo-1624353365286-3f8d62daad51?w=500',
      is_featured: true,
      tags: ['Destaque do chef'],
      translations: { en: { name: 'Chocolate Lava Cake', description: 'Chocolate cake with creamy filling, vanilla ice cream and red fruit sauce' } }
    },
    {
      category: 'Sobremesas',
      name: 'Tiramisù',
      description: 'Clássica sobremesa italiana com café, mascarpone e cacau',
      price: 26.00,
      image_url: 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?w=500',
      tags: ['Vegetariano'],
      translations: { en: { name: 'Tiramisu', description: 'Classic Italian dessert with coffee, mascarpone and cocoa' } }
    },
    {
      category: 'Sobremesas',
      name: 'Cheesecake de Frutas Vermelhas',
      description: 'Cheesecake cremoso com calda de frutas vermelhas frescas',
      price: 24.00,
      image_url: 'https://images.unsplash.com/photo-1533134242443-d4fd215305ad?w=500',
      tags: ['Vegetariano', 'Sem Glúten'],
      translations: { en: { name: 'Red Fruit Cheesecake', description: 'Creamy cheesecake with fresh red fruit sauce' } }
    },
    {
      category: 'Sobremesas',
      name: 'Pudim de Leite Condensado',
      description: 'Tradicional pudim brasileiro com calda de caramelo',
      price: 18.00,
      image_url: 'https://images.unsplash.com/photo-1528975604071-b4dc52a2d18c?w=500',
      tags: ['Vegetariano'],
      translations: { en: { name: 'Condensed Milk Flan', description: 'Traditional Brazilian flan with caramel sauce' } }
    },
    // Bebidas
    {
      category: 'Bebidas',
      name: 'Suco Natural de Laranja',
      description: 'Suco de laranja espremido na hora',
      price: 12.00,
      image_url: 'https://images.unsplash.com/photo-1621506289937-a8e4df240d0b?w=500',
      tags: ['Sem Glúten', 'Vegano'],
      translations: { en: { name: 'Fresh Orange Juice', description: 'Freshly squeezed orange juice' } }
    },
    {
      category: 'Bebidas',
      name: 'Coca-Cola 350ml',
      description: 'Refrigerante Coca-Cola lata 350ml',
      price: 8.00,
      image_url: 'https://images.unsplash.com/photo-1554866585-cd94860890b7?w=500',
      tags: [],
      translations: { en: { name: 'Coca-Cola 350ml', description: 'Coca-Cola 350ml can' } }
    },
    {
      category: 'Bebidas',
      name: 'Água Mineral 500ml',
      description: 'Água mineral sem gás 500ml',
      price: 6.00,
      image_url: 'https://images.unsplash.com/photo-1548839140-29a749e1cf4d?w=500',
      tags: ['Sem Glüten', 'Vegano'],
      translations: { en: { name: 'Mineral Water 500ml', description: 'Still mineral water 500ml' } }
    },
    {
      category: 'Bebidas',
      name: 'Caipiroska de Limão',
      description: 'Vodka, limão, açúcar e gelo',
      price: 22.00,
      image_url: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=500',
      is_featured: true,
      tags: ['Alcoólico'],
      translations: { en: { name: 'Lime Caipiroska', description: 'Vodka, lime, sugar and ice' } }
    },
    {
      category: 'Bebidas',
      name: 'Mojito Clássico',
      description: 'Rum branco, hortelã, limão, açúcar e água com gás',
      price: 24.00,
      image_url: 'https://images.unsplash.com/photo-1551538827-9c037cb4f32a?w=500',
      tags: ['Alcoólico'],
      translations: { en: { name: 'Classic Mojito', description: 'White rum, mint, lime, sugar and soda water' } }
    }
  ]

  for (const prod of products) {
    await supabase
      .from('products')
      .upsert({
        tenant_id: tenantId,
        menu_id: menuId,
        category_id: categoryIds[prod.category] || null,
        name: prod.name,
        description: prod.description,
        price: prod.price,
        original_price: prod.original_price || null,
        image_url: prod.image_url,
        image_urls: [prod.image_url],
        is_available: true,
        is_featured: prod.is_featured || false,
        tags: prod.tags || []
      }, { onConflict: 'tenant_id,name' })
  }

  console.log('✅ Created', products.length, 'products')

  // 8. Create QR Codes
  const qrCodes = [
    { label: 'QR Mesa 1', target_url: 'https://xmartmenu.skale.club/r/restaurante-teste?table=1', scans: 127 },
    { label: 'QR Mesa 2', target_url: 'https://xmartmenu.skale.club/r/restaurante-teste?table=2', scans: 89 },
    { label: 'QR Mesa 3', target_url: 'https://xmartmenu.skale.club/r/restaurante-teste?table=3', scans: 54 },
    { label: 'QR Entrada', target_url: 'https://xmartmenu.skale.club/r/restaurante-teste', scans: 342 },
    { label: 'QR Cardápio Digital', target_url: 'https://xmartmenu.skale.club/r/restaurante-teste', scans: 512 },
    { label: 'QR Instagram', target_url: 'https://xmartmenu.skale.club/r/restaurante-teste?ref=instagram', scans: 78 }
  ]

  for (const qr of qrCodes) {
    // Delete existing first
    await supabase
      .from('qr_codes')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('label', qr.label)
    
    const { error } = await supabase
      .from('qr_codes')
      .insert({
        tenant_id: tenantId,
        label: qr.label,
        target_url: qr.target_url,
        scans: qr.scans
      })
    
    if (error) {
      console.error('Error creating QR code:', qr.label, error)
    }
  }

  console.log('✅ Created', qrCodes.length, 'QR codes')

  // 9. Create scan events
  const { data: createdQrCodes } = await supabase
    .from('qr_codes')
    .select('id')
    .eq('tenant_id', tenantId)

  console.log('  Found', createdQrCodes?.length || 0, 'QR codes for scan events')

  const userAgents = [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)',
    'Mozilla/5.0 (Linux; Android 12; SM-G991B)',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1'
  ]

  const countries = ['BR', 'US', 'AR', 'PT']

  const scanEvents = []
  if (createdQrCodes && createdQrCodes.length > 0) {
    for (let i = 0; i < 50; i++) {
      const qrId = createdQrCodes[Math.floor(Math.random() * createdQrCodes.length)].id
      scanEvents.push({
        tenant_id: tenantId,
        qr_code_id: qrId,
        scanned_at: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
        user_agent: userAgents[Math.floor(Math.random() * userAgents.length)],
        country: countries[Math.floor(Math.random() * countries.length)]
      })
    }
  }

  if (scanEvents.length > 0) {
    await supabase.from('scan_events').insert(scanEvents)
  }

  console.log('✅ Created', scanEvents.length, 'scan events')

  // 10. Create sample orders
  const orders = [
    { customer_name: 'João Silva', customer_phone: '11988887777', status: 'completed', total: 127.80 },
    { customer_name: 'Maria Santos', customer_phone: '11977776666', status: 'completed', total: 89.90 },
    { customer_name: 'Pedro Oliveira', customer_phone: '11966665555', status: 'confirmed', total: 156.00 },
    { customer_name: 'Ana Costa', customer_phone: '11955554444', status: 'pending', total: 72.00 },
    { customer_name: 'Carlos Ferreira', customer_phone: '11944443333', status: 'pending', total: 98.00 }
  ]

  const { data: createdProducts } = await supabase
    .from('products')
    .select('id, name, price')
    .eq('tenant_id', tenantId)

  for (const order of orders) {
    const { data: createdOrder } = await supabase
      .from('orders')
      .insert({
        tenant_id: tenantId,
        customer_name: order.customer_name,
        customer_phone: order.customer_phone,
        status: order.status,
        total: order.total
      })
      .select()
      .single()

    if (createdOrder && createdProducts && createdProducts.length > 0) {
      // Add random items to order
      const numItems = Math.floor(Math.random() * 3) + 1
      const orderItems = []
      for (let i = 0; i < numItems; i++) {
        const product = createdProducts[Math.floor(Math.random() * createdProducts.length)]
        orderItems.push({
          order_id: createdOrder.id,
          product_id: product.id,
          product_name: product.name,
          quantity: Math.floor(Math.random() * 3) + 1,
          unit_price: product.price,
          notes: Math.random() > 0.7 ? 'Sem cebola' : null
        })
      }
      await supabase.from('order_items').insert(orderItems)
    }
  }

  console.log('✅ Created', orders.length, 'orders with items')

  // 11. Create staff members
  const staffMembers = [
    { name: 'Ana Paula Silva', email: 'ana.paula@restauranteteste.com' },
    { name: 'Carlos Eduardo', email: 'carlos@restauranteteste.com' },
    { name: 'Mariana Costa', email: 'mariana@restauranteteste.com' }
  ]

  const defaultPassword = 'Staff@12345'
  let staffCreated = 0

  for (const staff of staffMembers) {
    // Check if user already exists
    const { data: { users: existingUsers } } = await supabase.auth.admin.listUsers()
    const existingUser = existingUsers.find(u => u.email === staff.email)
    
    if (existingUser) {
      // Update profile if user exists
      await supabase
        .from('profiles')
        .upsert({
          id: existingUser.id,
          tenant_id: tenantId,
          role: 'store-staff',
          full_name: staff.name,
          must_change_password: true
        }, { onConflict: 'id' })
      console.log('  ✅ Updated existing staff:', staff.email)
    } else {
      // Create new user
      const { data: userData, error: userError } = await supabase.auth.admin.createUser({
        email: staff.email,
        password: defaultPassword,
        email_confirm: true,
        user_metadata: { full_name: staff.name }
      })

      if (userError) {
        console.error('  ❌ Error creating staff:', staff.email, userError.message)
        continue
      }

      if (userData.user) {
        await supabase
          .from('profiles')
          .upsert({
            id: userData.user.id,
            tenant_id: tenantId,
            role: 'store-staff',
            full_name: staff.name,
            must_change_password: true
          }, { onConflict: 'id' })
        
        staffCreated++
        console.log('  ✅ Created staff:', staff.email, '(password:', defaultPassword + ')')
      }
    }
  }

  console.log('✅ Created', staffCreated, 'new staff members')

  console.log('\n🎉 Seed completed successfully!')
  console.log('Tenant ID:', tenantId)
  console.log('User ID:', user.id)
  console.log('\n📋 Summary:')
  console.log('  - 2 menus (Cardápio Principal + Carta de Bebidas)')
  console.log('  - 4 categories with 19 products')
  console.log('  - 6 QR codes')
  console.log('  - 50 scan events')
  console.log('  - 5 orders with items')
  console.log('  - 3 staff members (password:', defaultPassword + ')')
}

seed().catch(console.error)
