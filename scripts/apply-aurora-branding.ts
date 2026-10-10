import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'node:path'

config({ path: resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceKey) throw new Error('Missing Supabase credentials')

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const shouldApply = process.argv.includes('--apply')
const tenantSlug = 'restaurante-teste'
const assetBasePath = '/brands/aurora-kitchen-bar'
const publicBaseUrl = 'https://xmartmenu.skale.club'
const logoUrl = `${assetBasePath}/logo.webp`
const bannerUrl = `${assetBasePath}/banner.webp`

const productAssets: Record<string, string> = {
  'Chocolate Lava Cake': 'chocolate-lava-cake.webp',
  'Fresh Orange Juice': 'fresh-orange-juice.webp',
  'Premium Picanha': 'premium-picanha.webp',
  'Italian Bruschetta': 'italian-bruschetta.webp',
  Tiramisu: 'tiramisu.webp',
  'Filet Mignon with Madeira Sauce': 'filet-mignon-madeira.webp',
  'Beef Carpaccio': 'beef-carpaccio.webp',
  'Coca-Cola 350ml': 'cola-350ml.webp',
  'Red Berry Cheesecake': 'red-berry-cheesecake.webp',
  'Grilled Salmon': 'grilled-salmon.webp',
  'Caesar Salad': 'caesar-salad.webp',
  'Still Mineral Water 500ml': 'still-mineral-water.webp',
  'Cod Fritters': 'cod-fritters.webp',
  'Porcini Risotto': 'porcini-risotto.webp',
  'Lime Caipiroska': 'lime-caipiroska.webp',
  'Brazilian Caramel Flan': 'brazilian-caramel-flan.webp',
  'Classic Mojito': 'classic-mojito.webp',
  'Artisan Burger': 'artisan-burger.webp',
  'Chicken Parmigiana': 'chicken-parmigiana.webp',
}

async function main() {
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('id, name, slug')
    .eq('slug', tenantSlug)
    .single()

  if (tenantError || !tenant) throw tenantError ?? new Error('Aurora tenant not found')

  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('id, name, image_url')
    .eq('tenant_id', tenant.id)
    .order('position')

  if (productsError) throw productsError

  const productIds = products.map(product => product.id)
  const { data: media, error: mediaError } = productIds.length > 0
    ? await supabase
        .from('product_media')
        .select('id, product_id, type, url, display_order')
        .in('product_id', productIds)
        .order('display_order')
    : { data: [], error: null }

  if (mediaError) throw mediaError

  const mapped = products.filter(product => productAssets[product.name])
  const missing = Object.keys(productAssets).filter(name => !products.some(product => product.name === name))

  console.log(`${shouldApply ? 'APPLY' : 'DRY RUN'}: ${tenant.name} (${tenant.id})`)
  console.log(`Products found: ${products.length}; mapped: ${mapped.length}; missing: ${missing.length}`)
  for (const product of products) {
    const imageCount = media.filter(item => item.product_id === product.id && item.type === 'image').length
    console.log(`- ${product.name}: ${productAssets[product.name] ? 'mapped' : 'unmapped'}, ${imageCount} image media row(s)`)
  }

  if (missing.length > 0) throw new Error(`Missing products: ${missing.join(', ')}`)
  if (!shouldApply) {
    console.log('No changes made. Run with --apply to update branding and product images.')
    return
  }

  const { error: settingsError } = await supabase
    .from('tenant_settings')
    .update({
      logo_url: logoUrl,
      banner_url: bannerUrl,
      seo_og_image_url: `${publicBaseUrl}${bannerUrl}`,
    })
    .eq('tenant_id', tenant.id)

  if (settingsError) throw settingsError

  for (const product of mapped) {
    const imageUrl = `${assetBasePath}/${productAssets[product.name]}`
    const { error: productError } = await supabase
      .from('products')
      .update({ image_url: imageUrl, image_urls: [imageUrl] })
      .eq('id', product.id)

    if (productError) throw productError

    const primaryMedia = media
      .filter(item => item.product_id === product.id && item.type === 'image')
      .sort((a, b) => a.display_order - b.display_order)[0]

    if (primaryMedia) {
      const { error } = await supabase.from('product_media').update({ url: imageUrl }).eq('id', primaryMedia.id)
      if (error) throw error
    } else {
      const { error } = await supabase.from('product_media').insert({
        tenant_id: tenant.id,
        product_id: product.id,
        type: 'image',
        url: imageUrl,
        display_order: 0,
      })
      if (error) throw error
    }
  }

  console.log(`Updated logo, banner and ${mapped.length} product photos.`)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
