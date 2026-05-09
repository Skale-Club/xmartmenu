import { createServiceClient } from '@/lib/supabase/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { generateObject } from 'ai'
import { google } from '@ai-sdk/google'
import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { sanitizeForPrompt } from '@/lib/ai/sanitize'
import {
  MenuSeedSchema,
  CopySeedSchema,
  SingleCategorySeedSchema,
  SingleProductSeedSchema,
} from '@/lib/ai/schemas'

// Node.js runtime required | Gemini SDK uses native Node APIs (D-04 constraint)
export const runtime = 'nodejs'
export const maxDuration = 60  // Gemini text: < 10s typical; 60s headroom

type SeedType = 'menu' | 'categories' | 'products' | 'copy' | 'single_category' | 'single_product'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tenantId } = await params

  // Auth guard | assertSuperadmin returns client or null (SEC-03 pattern)
  const supabase = await assertSuperadmin()
  if (!supabase) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const {
    type,
    menuId,
    businessType = '',
    companyName = '',
  } = body as {
    type: SeedType
    menuId: string
    businessType?: string
    companyName?: string
  }

  if (!menuId) return NextResponse.json({ error: 'menuId is required' }, { status: 400 })
  if (!type) return NextResponse.json({ error: 'type is required' }, { status: 400 })

  // D-08: Sanitize before any LLM interpolation | strip prompt injection chars
  const safeBusinessType = sanitizeForPrompt(businessType)
  const safeCompanyName  = sanitizeForPrompt(companyName)

  const service = await createServiceClient()

  // Fetch tenant slug for revalidatePath (D-10)
  const { data: tenant } = await service
    .from('tenants')
    .select('slug')
    .eq('id', tenantId)
    .single()

  // Fetch menu slug + supported_languages (D-05: all enabled languages in single call)
  const { data: menu } = await service
    .from('menus')
    .select('slug, supported_languages')
    .eq('id', menuId)
    .eq('tenant_id', tenantId)
    .single()

  if (!menu) return NextResponse.json({ error: 'Menu not found or does not belong to this tenant' }, { status: 404 })

  const supportedLangs: string[] = menu.supported_languages ?? ['en']
  const multiLang = supportedLangs.filter(l => l !== 'en')
  const langInstruction = multiLang.length > 0
    ? ` Also provide translations for: ${multiLang.join(', ')}. Use locale keys (e.g. "pt", "es") in the "translations" object.`
    : ''

  let categoriesCreated = 0
  let productsCreated = 0
  let totalTokens = 0

  try {
    if (type === 'menu' || type === 'categories') {
      // ── Generate categories (and products if type='menu') ──────────────

      // Fetch existing category names | additive-only (D-07)
      const { data: existingCats } = await service
        .from('categories')
        .select('name, id')
        .eq('tenant_id', tenantId)
        .eq('menu_id', menuId)

      const existingCatNames = new Set((existingCats ?? []).map(c => c.name.toLowerCase()))

      // Fetch MAX position for ordering (Pitfall 6)
      const { data: maxCatPos } = await service
        .from('categories')
        .select('position')
        .eq('tenant_id', tenantId)
        .eq('menu_id', menuId)
        .order('position', { ascending: false })
        .limit(1)
        .single()

      const nextCatPosition = ((maxCatPos?.position ?? -1) + 1)

      const prompt = type === 'menu'
        ? `Generate a realistic restaurant menu for a ${safeBusinessType || 'restaurant'} named """${safeCompanyName || 'the restaurant'}""". Create 4-6 categories typical for this type of establishment (e.g. for a pizzeria: Pizzas, Pastas, Drinks, Desserts). For each category, generate 3-5 representative menu items with realistic names, descriptions, and prices (in numbers, no currency symbols).${langInstruction} Return ONLY valid JSON matching the schema. Do not include commentary.`
        : `Generate 4-6 menu categories for a ${safeBusinessType || 'restaurant'} named """${safeCompanyName || 'the restaurant'}""". Categories should be typical for this establishment type. Include empty products arrays.${langInstruction} Return ONLY valid JSON.`

      const { object: menuObj, usage } = await generateObject({
        model: google('gemini-2.5-flash'),
        schema: MenuSeedSchema,
        prompt,
      })

      totalTokens += usage?.totalTokens ?? 0

      const newCats = menuObj.categories.filter(
        c => !existingCatNames.has(c.name.toLowerCase())
      )

      if (newCats.length > 0) {
        const catsToInsert = newCats.map((c, i) => ({
          tenant_id: tenantId,
          menu_id: menuId,
          name: c.name,
          description: c.description || null,
          translations: (c.translations && Object.keys(c.translations).length > 0) ? c.translations : {},
          position: nextCatPosition + i,
          is_active: true,
        }))

        const { data: insertedCats, error: catErr } = await service
          .from('categories')
          .insert(catsToInsert)
          .select('id, name')

        if (catErr) throw new Error(`Category insert failed: ${catErr.message}`)
        categoriesCreated = insertedCats?.length ?? 0

        // If type='menu', also insert products for each new category
        if (type === 'menu' && insertedCats) {
          // Fetch MAX product position
          const { data: maxProdPos } = await service
            .from('products')
            .select('position')
            .eq('tenant_id', tenantId)
            .eq('menu_id', menuId)
            .order('position', { ascending: false })
            .limit(1)
            .single()

          let nextProdPosition = ((maxProdPos?.position ?? -1) + 1)

          const existingCatMap = new Map(insertedCats.map(c => [c.name.toLowerCase(), c.id]))

          for (const cat of newCats) {
            const categoryId = existingCatMap.get(cat.name.toLowerCase())
            if (!categoryId || !cat.products?.length) continue

            // Fetch existing product names in this category (D-07)
            const { data: existingProds } = await service
              .from('products')
              .select('name')
              .eq('tenant_id', tenantId)
              .eq('category_id', categoryId)

            const existingProdNames = new Set((existingProds ?? []).map(p => p.name.toLowerCase()))

            const prodsToInsert = cat.products
              .filter(p => !existingProdNames.has(p.name.toLowerCase()))
              .map((p, i) => ({
                tenant_id: tenantId,
                menu_id: menuId,
                category_id: categoryId,
                name: p.name,
                description: p.description || null,
                translations: (p.translations && Object.keys(p.translations).length > 0) ? p.translations : {},
                price: p.price ?? 0,
                is_available: true,
                is_featured: false,
                tags: [],
                image_urls: [],
                position: nextProdPosition + i,
              }))

            if (prodsToInsert.length > 0) {
              const { data: insertedProds, error: prodErr } = await service
                .from('products')
                .insert(prodsToInsert)
                .select('id')

              if (prodErr) throw new Error(`Product insert failed: ${prodErr.message}`)
              productsCreated += insertedProds?.length ?? 0
              nextProdPosition += prodsToInsert.length
            }
          }
        }
      }
    }

    else if (type === 'products') {
      // ── Generate products for existing categories ──────────────────────
      const { data: existingCats } = await service
        .from('categories')
        .select('id, name')
        .eq('tenant_id', tenantId)
        .eq('menu_id', menuId)

      if (!existingCats?.length) {
        return NextResponse.json({ error: 'No categories found | seed categories first' }, { status: 400 })
      }

      const { data: maxProdPos } = await service
        .from('products')
        .select('position')
        .eq('tenant_id', tenantId)
        .eq('menu_id', menuId)
        .order('position', { ascending: false })
        .limit(1)
        .single()

      let nextProdPosition = ((maxProdPos?.position ?? -1) + 1)

      const catNames = existingCats.map(c => c.name).join(', ')

      const { object: menuObj, usage } = await generateObject({
        model: google('gemini-2.5-flash'),
        schema: MenuSeedSchema,
        prompt: `Generate 3-5 menu items for each of these categories of a ${safeBusinessType || 'restaurant'} named """${safeCompanyName || 'the restaurant'}""": ${catNames}. Use the exact category names provided. Include realistic names, descriptions, and prices (numbers only).${langInstruction} Return ONLY valid JSON.`,
      })

      totalTokens += usage?.totalTokens ?? 0

      const catMap = new Map(existingCats.map(c => [c.name.toLowerCase(), c.id]))

      for (const cat of menuObj.categories) {
        const categoryId = catMap.get(cat.name.toLowerCase())
        if (!categoryId || !cat.products?.length) continue

        const { data: existingProds } = await service
          .from('products')
          .select('name')
          .eq('tenant_id', tenantId)
          .eq('category_id', categoryId)

        const existingProdNames = new Set((existingProds ?? []).map(p => p.name.toLowerCase()))

        const prodsToInsert = cat.products
          .filter(p => !existingProdNames.has(p.name.toLowerCase()))
          .map((p, i) => ({
            tenant_id: tenantId,
            menu_id: menuId,
            category_id: categoryId,
            name: p.name,
            description: p.description || null,
            translations: (p.translations && Object.keys(p.translations).length > 0) ? p.translations : {},
            price: p.price ?? 0,
            is_available: true,
            is_featured: false,
            tags: [],
            image_urls: [],
            position: nextProdPosition + i,
          }))

        if (prodsToInsert.length > 0) {
          const { data: insertedProds, error: prodErr } = await service
            .from('products')
            .insert(prodsToInsert)
            .select('id')

          if (prodErr) throw new Error(`Product insert failed: ${prodErr.message}`)
          productsCreated += insertedProds?.length ?? 0
          nextProdPosition += prodsToInsert.length
        }
      }
    }

    else if (type === 'copy') {
      // ── Generate restaurant copy | AI-04 ──────────────────────────────
      const { object: copyObj, usage } = await generateObject({
        model: google('gemini-2.5-flash'),
        schema: CopySeedSchema,
        prompt: `Generate a short tagline (max 10 words) and a brief "about us" paragraph (2-3 sentences) for a ${safeBusinessType || 'restaurant'} named """${safeCompanyName || 'the restaurant'}""". Tone: warm, inviting, professional. Return ONLY valid JSON.`,
      })

      totalTokens += usage?.totalTokens ?? 0

      const { error: copyErr } = await service
        .from('tenant_settings')
        .upsert({
          tenant_id: tenantId,
          tagline: copyObj.tagline,
          about: copyObj.about,
        }, { onConflict: 'tenant_id' })

      if (copyErr) throw new Error(`Copy update failed: ${copyErr.message}`)
    }

    else if (type === 'single_category') {
      // ── Generate one category | AI-06 ─────────────────────────────────
      const { data: existingCats } = await service
        .from('categories')
        .select('name')
        .eq('tenant_id', tenantId)
        .eq('menu_id', menuId)

      const existingCatNames = new Set((existingCats ?? []).map(c => c.name.toLowerCase()))

      const { data: maxCatPos } = await service
        .from('categories')
        .select('position')
        .eq('tenant_id', tenantId)
        .eq('menu_id', menuId)
        .order('position', { ascending: false })
        .limit(1)
        .single()

      const { object: singleCat, usage } = await generateObject({
        model: google('gemini-2.5-flash'),
        schema: SingleCategorySeedSchema,
        prompt: `Generate one new menu category for a ${safeBusinessType || 'restaurant'} named """${safeCompanyName || 'the restaurant'}""" that does not already exist. Existing categories: ${[...existingCatNames].join(', ') || 'none'}. Return only a single category with name and description.${langInstruction}`,
      })

      totalTokens += usage?.totalTokens ?? 0

      if (!existingCatNames.has(singleCat.name.toLowerCase())) {
        const { error: catErr } = await service
          .from('categories')
          .insert({
            tenant_id: tenantId,
            menu_id: menuId,
            name: singleCat.name,
            description: singleCat.description || null,
            translations: (singleCat.translations && Object.keys(singleCat.translations).length > 0) ? singleCat.translations : {},
            position: ((maxCatPos?.position ?? -1) + 1),
            is_active: true,
          })

        if (catErr) throw new Error(`Single category insert failed: ${catErr.message}`)
        categoriesCreated = 1
      }
    }

    else if (type === 'single_product') {
      // ── Generate one product | AI-06 ──────────────────────────────────
      // categoryId must be provided in body for per-item product seeding
      const { categoryId } = body as { categoryId?: string }
      if (!categoryId) return NextResponse.json({ error: 'categoryId required for single_product' }, { status: 400 })

      const { data: existingProds } = await service
        .from('products')
        .select('name')
        .eq('tenant_id', tenantId)
        .eq('category_id', categoryId)

      const existingProdNames = new Set((existingProds ?? []).map(p => p.name.toLowerCase()))

      const { data: catData } = await service
        .from('categories')
        .select('name')
        .eq('id', categoryId)
        .single()

      const { data: maxProdPos } = await service
        .from('products')
        .select('position')
        .eq('tenant_id', tenantId)
        .eq('category_id', categoryId)
        .order('position', { ascending: false })
        .limit(1)
        .single()

      const { object: singleProd, usage } = await generateObject({
        model: google('gemini-2.5-flash'),
        schema: SingleProductSeedSchema,
        prompt: `Generate one new menu item for the "${catData?.name ?? 'menu'}" category of a ${safeBusinessType || 'restaurant'} named """${safeCompanyName || 'the restaurant'}""". Existing items: ${[...existingProdNames].join(', ') || 'none'}. Include a realistic name, description, and price (number only, no currency).${langInstruction}`,
      })

      totalTokens += usage?.totalTokens ?? 0

      if (!existingProdNames.has(singleProd.name.toLowerCase())) {
        const { error: prodErr } = await service
          .from('products')
          .insert({
            tenant_id: tenantId,
            menu_id: menuId,
            category_id: categoryId,
            name: singleProd.name,
            description: singleProd.description || null,
            translations: (singleProd.translations && Object.keys(singleProd.translations).length > 0) ? singleProd.translations : {},
            price: singleProd.price ?? 0,
            is_available: true,
            is_featured: false,
            tags: [],
            image_urls: [],
            position: ((maxProdPos?.position ?? -1) + 1),
          })

        if (prodErr) throw new Error(`Single product insert failed: ${prodErr.message}`)
        productsCreated = 1
      }
    }

    else {
      return NextResponse.json({ error: `Unknown type: ${type}` }, { status: 400 })
    }

  } catch (err) {
    console.error('[seed] generation or insert error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Seeding failed | check server logs' },
      { status: 500 }
    )
  }

  // ── Log ai_usage (non-blocking | D-09) ────────────────────────────────────
  try {
    const today = new Date().toISOString().slice(0, 10)
    await service.from('ai_usage').upsert({
      tenant_id: tenantId,
      feature_key: 'text_seed',
      date: today,
      call_count: 1,
      token_count: totalTokens,
    }, { onConflict: 'tenant_id,feature_key,date' })
  } catch (e) {
    console.error('[ai_usage] non-blocking log failed:', e)
  }

  // ── Invalidate ISR cache (D-10) ────────────────────────────────────────────
  if (tenant?.slug) {
    revalidatePath(`/${tenant.slug}`)
    if (menu?.slug) revalidatePath(`/${tenant.slug}/${menu.slug}`)
  }

  return NextResponse.json({
    success: true,
    categoriesCreated,
    productsCreated,
    tokensUsed: totalTokens,
  })
}
