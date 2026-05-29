import { createServiceClient } from '@/lib/supabase/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { generateObject } from 'ai'
import { openai } from '@ai-sdk/openai'
import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { OcrMenuSchema } from '@/lib/ai/schemas'
import { getStorageClient } from '@/lib/storage'

// Node.js runtime required | @ai-sdk/openai uses native Node APIs (D-04 constraint)
export const runtime = 'nodejs'
export const maxDuration = 60  // GPT-4.1-mini vision: typically 5–15s; 60s headroom

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tenantId } = await params

  // Auth guard | assertSuperadmin returns client or null (SEC-03 pattern)
  const supabase = await assertSuperadmin()
  if (!supabase) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { storagePath, menuId } = body as { storagePath?: string; menuId?: string }

  if (!storagePath) return NextResponse.json({ error: 'storagePath is required' }, { status: 400 })
  if (!menuId) return NextResponse.json({ error: 'menuId is required' }, { status: 400 })

  const service = createServiceClient()

  // Validate menu belongs to tenant
  const { data: menu } = await service
    .from('menus')
    .select('slug, supported_languages')
    .eq('id', menuId)
    .eq('tenant_id', tenantId)
    .single()

  if (!menu) return NextResponse.json({ error: 'Menu not found or does not belong to this tenant' }, { status: 404 })

  // Fetch tenant slug for revalidatePath (D-10)
  const { data: tenant } = await service
    .from('tenants')
    .select('slug')
    .eq('id', tenantId)
    .single()

  // Download image from storage
  let imageBuffer: Buffer
  try {
    imageBuffer = await getStorageClient().download('tenant-assets', storagePath)
  } catch (downloadError) {
    console.error('POST /api/superadmin/tenants/[id]/ocr-menu (download):', downloadError)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }

  // Convert Buffer to base64 for AI SDK vision message
  const base64 = imageBuffer.toString('base64')
  // Infer mime type from storage path extension
  const ext = storagePath.split('.').pop()?.toLowerCase()
  const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
  const imageUrl = `data:${mimeType};base64,${base64}`

  let categoriesCreated = 0
  let productsCreated = 0
  let totalTokens = 0

  try {
    // Call GPT-4.1-mini vision with OcrMenuSchema for structured extraction
    const { object: ocrResult, usage } = await generateObject({
      model: openai('gpt-4.1-mini'),
      schema: OcrMenuSchema,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              image: imageUrl,
            },
            {
              type: 'text',
              text: 'Extract all menu categories, item names, and prices from this menu photo. For prices, return a number (no currency symbols). If a price is not visible or unreadable, return 0. If a description is not visible, return null. Return ONLY valid JSON matching the schema.',
            },
          ],
        },
      ],
    })

    totalTokens = usage?.totalTokens ?? 0

    // ── Write categories + products to DB (additive-only | D-07) ──────────

    // Fetch existing category names to avoid duplicates
    const { data: existingCats } = await service
      .from('categories')
      .select('name, id')
      .eq('tenant_id', tenantId)
      .eq('menu_id', menuId)

    const existingCatNames = new Set((existingCats ?? []).map(c => c.name.toLowerCase()))

    // Fetch MAX category position
    const { data: maxCatPos } = await service
      .from('categories')
      .select('position')
      .eq('tenant_id', tenantId)
      .eq('menu_id', menuId)
      .order('position', { ascending: false })
      .limit(1)
      .single()

    const nextCatPosition = ((maxCatPos?.position ?? -1) + 1)

    const newCats = ocrResult.categories.filter(
      c => !existingCatNames.has(c.name.toLowerCase())
    )

    if (newCats.length > 0) {
      const catsToInsert = newCats.map((c, i) => ({
        tenant_id: tenantId,
        menu_id: menuId,
        name: c.name,
        description: null,
        translations: {},
        position: nextCatPosition + i,
        is_active: true,
      }))

      const { data: insertedCats, error: catErr } = await service
        .from('categories')
        .insert(catsToInsert)
        .select('id, name')

      if (catErr) throw new Error(`Category insert failed: ${catErr.message}`)
      categoriesCreated = insertedCats?.length ?? 0

      if (insertedCats) {
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

        const insertedCatMap = new Map(insertedCats.map(c => [c.name.toLowerCase(), c.id]))

        for (const cat of newCats) {
          const categoryId = insertedCatMap.get(cat.name.toLowerCase())
          if (!categoryId || !cat.products?.length) continue

          // Fetch existing product names in this category (D-07 additive)
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
              description: p.description ?? null,       // null when not visible (D-06)
              translations: {},
              price: p.price ?? 0,                      // 0 for unreadable prices (AI-12, D-12)
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

  } catch (err) {
    console.error('[ocr-menu] vision or insert error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }

  // ── Log ai_usage (non-blocking | D-09) ────────────────────────────────────
  try {
    const today = new Date().toISOString().slice(0, 10)
    await service.from('ai_usage').upsert({
      tenant_id: tenantId,
      feature_key: 'ocr_menu',
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
