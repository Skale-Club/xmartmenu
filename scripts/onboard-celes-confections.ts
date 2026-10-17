import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'node:path'
import { generatePassword } from '../src/lib/auth/password-gen'
import { enqueueXphereSync } from '../src/lib/xphere/queue'

config({ path: resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceKey) throw new Error('Missing Supabase credentials')

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const shouldApply = process.argv.includes('--apply')
const tenantSlug = 'celes-confections'
const ownerEmail = 'hello@celesconfections.com'
const publicBaseUrl = 'https://xmartmenu.skale.club'
const assetBasePath = '/brands/celes-confections'

type ProductSeed = {
  name: string
  description: string
  price: number
  image?: string
  available?: boolean
  featured?: boolean
  options: Array<{ name: string; price: number }>
}

type CategorySeed = {
  name: string
  description: string
  products: ProductSeed[]
}

const crepeSizes = [
  { name: 'Slice', price: 15 },
  { name: '5-inch Birthday Cake', price: 60 },
  { name: '10-inch Whole Cake', price: 180 },
]

const puddingTraySizes = [
  { name: 'Half Tray · up to 25 servings', price: 180 },
  { name: 'Full Tray · up to 50 servings', price: 350 },
]

const categories: CategorySeed[] = [
  {
    name: 'Mille Crêpe',
    description: 'Twenty delicate layers, made by hand in small batches. Slices and celebration cakes available.',
    products: [
      {
        name: 'Classic',
        description: 'Vanilla crêpes with diplomat cream.',
        price: 15,
        image: 'classic.webp',
        available: false,
        options: crepeSizes,
      },
      {
        name: 'Lemon',
        description: 'Lemon crêpes with lemon curd mousse.',
        price: 15,
        image: 'lemon.webp',
        featured: true,
        options: crepeSizes,
      },
      {
        name: 'Matcha',
        description: 'Matcha crêpes with matcha white chocolate mousse.',
        price: 15,
        image: 'matcha.webp',
        featured: true,
        options: crepeSizes,
      },
      {
        name: 'Tiramisu',
        description: 'Tiramisu crêpes with mascarpone coffee filling.',
        price: 15,
        image: 'tiramisu.webp',
        featured: true,
        options: crepeSizes,
      },
      {
        name: 'Strawberry',
        description: 'Vanilla crêpes with strawberry whipped cream.',
        price: 15,
        image: 'strawberry.webp',
        options: crepeSizes,
      },
      {
        name: 'Dulce de Leche',
        description: 'Vanilla crêpes with caramelized condensed milk whipped cream.',
        price: 15,
        image: 'dulce-de-leche.webp',
        featured: true,
        options: crepeSizes,
      },
      {
        name: 'Passion',
        description: 'Vanilla crêpes with passion fruit white chocolate mousse.',
        price: 15,
        image: 'passion.webp',
        options: crepeSizes,
      },
      {
        name: 'Mango',
        description: 'Vanilla crêpes with mango white chocolate mousse.',
        price: 15,
        image: 'mango.webp',
        options: crepeSizes,
      },
      {
        name: 'Ube · Purple Yam',
        description: 'Vanilla crêpes with purple yam white chocolate mousse.',
        price: 15,
        image: 'ube.webp',
        featured: true,
        options: crepeSizes,
      },
      {
        name: 'Dark Chocolate',
        description: 'Chocolate crêpes with dark chocolate mousse.',
        price: 15,
        image: 'dark-chocolate.webp',
        options: crepeSizes,
      },
      {
        name: 'Raspberry',
        description: 'Vanilla crêpes with raspberry white chocolate mousse.',
        price: 15,
        image: 'raspberry.webp',
        options: crepeSizes,
      },
      {
        name: 'Black Sesame',
        description: 'Black sesame crêpes with black sesame white chocolate mousse.',
        price: 15,
        image: 'black-sesame.webp',
        available: false,
        options: crepeSizes,
      },
    ],
  },
  {
    name: 'Party Puddings',
    description: 'Deep party trays, ready to serve. Three days’ notice requested.',
    products: [
      {
        name: 'Ube Coconut Pudding Tray',
        description: 'Purple yam, coconut cream and toasted coconut.',
        price: 180,
        image: 'pudding-ube-coconut.webp',
        options: puddingTraySizes,
      },
      {
        name: 'Banana Pudding Tray',
        description: 'Vanilla custard, ripe banana and vanilla wafer.',
        price: 180,
        image: 'pudding-banana.webp',
        options: puddingTraySizes,
      },
      {
        name: 'Strawberry Shortcake Pudding Tray',
        description: 'Vanilla custard, fresh strawberry and buttery shortcake crumble.',
        price: 180,
        image: 'pudding-strawberry-shortcake.webp',
        options: puddingTraySizes,
      },
      {
        name: 'Pistachio Pudding Tray',
        description: 'Silky pistachio custard with toasted pistachio crumble.',
        price: 180,
        image: 'pudding-pistachio.webp',
        options: puddingTraySizes,
      },
      {
        name: 'Pumpkin Spice Pudding Tray',
        description: 'Spiced pumpkin custard, cinnamon cream and gingersnap crumble.',
        price: 180,
        image: 'pudding-pumpkin-spice.webp',
        options: puddingTraySizes,
      },
      {
        name: 'Dulce de Leche Pudding Tray',
        description: 'Vanilla custard, caramelized condensed milk and toasted wafer.',
        price: 180,
        image: 'pudding-dulce-de-leche.webp',
        options: puddingTraySizes,
      },
    ],
  },
]

async function main() {
  const { data: existingTenant, error: existingTenantError } = await supabase
    .from('tenants')
    .select('id, name, slug')
    .eq('slug', tenantSlug)
    .maybeSingle()

  if (existingTenantError) throw existingTenantError

  const { data: plan, error: planError } = await supabase
    .from('plans')
    .select('id, name, slug')
    .eq('slug', 'menu')
    .eq('is_active', true)
    .single()

  if (planError || !plan) throw planError ?? new Error('Digital Menu plan not found')

  const productCount = categories.reduce((count, category) => count + category.products.length, 0)
  console.log(`${shouldApply ? 'APPLY' : 'DRY RUN'}: Celes Confections`)
  console.log(`Tenant slug: ${tenantSlug}`)
  console.log(`Owner: ${ownerEmail}`)
  console.log(`Plan: ${plan.name}`)
  console.log(`Menu: ${categories.length} categories, ${productCount} products`)

  if (existingTenant) {
    throw new Error(`Tenant already exists: ${existingTenant.name} (${existingTenant.id})`)
  }

  if (!shouldApply) {
    console.log('No changes made. Run with --apply to create the tenant.')
    return
  }

  let tenantId: string | null = null
  let ownerId: string | null = null

  try {
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      // `tenant_subscriptions` is canonical. The legacy snapshot column still
      // has the original free/pro/enterprise check constraint in production.
      .insert({ name: 'Celes Confections', slug: tenantSlug, plan: 'free' })
      .select('id, name, slug')
      .single()

    if (tenantError || !tenant) throw tenantError ?? new Error('Failed to create tenant')
    tenantId = tenant.id

    const logoUrl = `${assetBasePath}/logo.webp`
    const bannerUrl = `${assetBasePath}/cakes-trio.webp`

    const { error: settingsError } = await supabase.from('tenant_settings').insert({
      tenant_id: tenant.id,
      logo_url: logoUrl,
      banner_url: bannerUrl,
      primary_color: '#432E1E',
      accent_color: '#B28A58',
      address: '14 Brighton Ave, Boston, MA 02134',
      phone: '+1 330-313-0832',
      instagram: 'celesconfections',
      currency: 'USD',
      language: 'en',
      business_type: 'Dessert studio',
      tagline: 'Artisan mille crêpes and pastries, crafted with care.',
      about: 'Celes Confections is a Boston-born dessert studio devoted to crafting fine mille crêpes and elegant pastries. Every cake is made by hand in small batches with clean ingredients, subtle sweetness and thoughtfully balanced textures.',
      business_hours: {
        thu: 'Pickup by confirmation',
        fri: 'Pickup by confirmation',
        sat: 'Farmers market or pickup',
        sun: 'Farmers market or pickup',
      },
      orders_enabled: false,
      direct_orders_enabled: false,
      whatsapp_orders_enabled: false,
      dine_in_enabled: false,
      pickup_enabled: true,
      delivery_enabled: false,
      pickup_eta_minutes: 0,
      analytics_enabled: true,
      visual_feed_enabled: true,
      menu_default_view: 'feed',
      feed_autoplay_videos: false,
      seo_title: 'Celes Confections Menu | Artisan Mille Crêpes in Boston',
      seo_description: 'Explore artisan mille crêpes and party puddings from Celes Confections, handcrafted in small batches in Boston.',
      seo_keywords: 'mille crepe, crepe cake, Boston desserts, birthday cake, Celes Confections',
      seo_og_image_url: `${publicBaseUrl}${bannerUrl}`,
      city: 'Boston',
      region: 'MA',
      postal_code: '02134',
      country: 'US',
      price_range: '$$',
    })

    if (settingsError) throw settingsError

    const { error: subscriptionError } = await supabase.from('tenant_subscriptions').insert({
      tenant_id: tenant.id,
      plan_id: plan.id,
      billing_cycle: 'monthly',
      status: 'active',
    })

    if (subscriptionError) throw subscriptionError

    const { data: menu, error: menuError } = await supabase.from('menus').insert({
      tenant_id: tenant.id,
      name: 'Celes Menu',
      slug: 'main',
      description: 'Artisan mille crêpes and party desserts, made by hand in Boston.',
      language: 'en',
      supported_languages: ['en'],
      purpose: 'cafe',
      is_active: true,
      is_default: true,
      position: 0,
    }).select('id, slug').single()

    if (menuError || !menu) throw menuError ?? new Error('Failed to create menu')

    let productPosition = 0
    for (const [categoryPosition, categorySeed] of categories.entries()) {
      const { data: category, error: categoryError } = await supabase.from('categories').insert({
        tenant_id: tenant.id,
        menu_id: menu.id,
        name: categorySeed.name,
        description: categorySeed.description,
        position: categoryPosition,
        is_active: true,
      }).select('id').single()

      if (categoryError || !category) throw categoryError ?? new Error(`Failed to create ${categorySeed.name}`)

      for (const productSeed of categorySeed.products) {
        const imageUrl = productSeed.image ? `${assetBasePath}/${productSeed.image}` : null
        const { data: product, error: productError } = await supabase.from('products').insert({
          tenant_id: tenant.id,
          menu_id: menu.id,
          category_id: category.id,
          name: productSeed.name,
          description: productSeed.description,
          price: productSeed.price,
          image_url: imageUrl,
          image_urls: imageUrl ? [imageUrl] : [],
          is_available: productSeed.available ?? true,
          is_featured: productSeed.featured ?? false,
          show_in_feed: Boolean(imageUrl),
          tags: [],
          position: productPosition++,
        }).select('id').single()

        if (productError || !product) throw productError ?? new Error(`Failed to create ${productSeed.name}`)

        if (imageUrl) {
          const { error: mediaError } = await supabase.from('product_media').insert({
            tenant_id: tenant.id,
            product_id: product.id,
            type: 'image',
            url: imageUrl,
            display_order: 0,
          })
          if (mediaError) throw mediaError
        }

        const { data: optionGroup, error: optionGroupError } = await supabase
          .from('product_option_groups')
          .insert({
            tenant_id: tenant.id,
            product_id: product.id,
            name: categorySeed.name === 'Mille Crêpe' ? 'Size' : 'Tray Size',
            type: 'single',
            required: true,
            min_selections: 1,
            max_selections: 1,
            price_rule: 'fixed',
            position: 0,
          })
          .select('id')
          .single()

        if (optionGroupError || !optionGroup) {
          throw optionGroupError ?? new Error(`Failed to create options for ${productSeed.name}`)
        }

        const { error: optionsError } = await supabase.from('product_options').insert(
          productSeed.options.map((option, position) => ({
            tenant_id: tenant.id,
            group_id: optionGroup.id,
            name: option.name,
            base_price: option.price,
            price_modifier: 0,
            is_available: true,
            position,
          })),
        )

        if (optionsError) throw optionsError
      }
    }

    const { error: qrError } = await supabase.from('qr_codes').insert({
      tenant_id: tenant.id,
      label: 'Main Menu',
      target_url: `${publicBaseUrl}/${tenantSlug}`,
    })

    if (qrError) throw qrError

    const temporaryPassword = generatePassword(16)
    const { data: owner, error: ownerError } = await supabase.auth.admin.createUser({
      email: ownerEmail,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: { tenant_id: tenant.id, full_name: 'Celes Confections' },
    })

    if (ownerError || !owner.user) throw ownerError ?? new Error('Failed to create tenant owner')
    ownerId = owner.user.id

    const { error: profileError } = await supabase.from('profiles').upsert({
      id: owner.user.id,
      tenant_id: tenant.id,
      role: 'store-admin',
      full_name: 'Celes Confections',
      phone: '+1 330-313-0832',
      must_change_password: true,
      password_changed_at: null,
    }, { onConflict: 'id' })

    if (profileError) throw profileError

    await enqueueXphereSync(tenant.id, 'onboarded')

    console.log('Tenant created successfully.')
    console.log(`Public menu: ${publicBaseUrl}/${tenantSlug}`)
    console.log(`Admin email: ${ownerEmail}`)
    console.log(`Temporary password: ${temporaryPassword}`)
  } catch (error) {
    if (ownerId) await supabase.auth.admin.deleteUser(ownerId)
    if (tenantId) await supabase.from('tenants').delete().eq('id', tenantId)
    throw error
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
