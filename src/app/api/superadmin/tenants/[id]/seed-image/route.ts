import { createServiceClient } from '@/lib/supabase/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import {
  cropToAspect,
  generateOpenRouterImage,
  imageModelId,
  parseImageEngine,
  PLATFORM_KEY_MISSING,
  type ImageEngine,
} from '@/lib/ai/openrouter'
import { resolveAiAccess, type ResolvedAiAccess } from '@/lib/ai/access'
import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { sanitizeForPrompt } from '@/lib/ai/sanitize'
import { convertBufferToWebP } from '@/lib/upload'
import { getStorageClient } from '@/lib/storage'
import { withApi } from '@/lib/observability/with-api'
import { log } from '@/lib/observability/log'

// Node.js runtime required | Sharp uses native bindings (cannot run on Edge)
export const runtime = 'nodejs'
// maxDuration = 300: bulk product seeding can take several minutes (20 products | ~15s each)
// Requires Vercel Pro plan (D-05)
export const maxDuration = 300

type ImageSeedType = 'image_cover' | 'image_products' | 'image_single_product'

/**
 * One image through OpenRouter (Google Gemini Image or OpenAI GPT Image),
 * cropped to the requested shape — engines clamp to their own sizes — and
 * encoded as WebP for storage.
 */
async function generateSeedImage(access: ResolvedAiAccess, engine: ImageEngine, prompt: string, aspectRatio: string) {
  const model = imageModelId(engine)
  const image = await generateOpenRouterImage({
    apiKey: access.primary.apiKey,
    model,
    prompt,
    aspectRatio,
    fetchImpl: access.fetchFor(access.primary, model),
  })
  const cropped = await cropToAspect(image.bytes, aspectRatio)
  return { webpBuffer: await convertBufferToWebP(cropped), totalTokens: image.totalTokens }
}

async function handlePOST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tenantId } = await params

  // Auth guard | D-20: assertSuperadmin() first on every new route
  const supabase = await assertSuperadmin()
  if (!supabase) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const {
    type,
    menuId,
    productId,
    businessType = '',
    companyName = '',
    engine: rawEngine,
  } = body as {
    type: ImageSeedType
    menuId: string
    productId?: string
    businessType?: string
    companyName?: string
    /** 'google' (Gemini Image) or 'openai' (GPT Image); defaults to OPENROUTER_IMAGE_ENGINE. */
    engine?: string
  }
  const engine = parseImageEngine(rawEngine)

  if (!type) return NextResponse.json({ error: 'type is required' }, { status: 400 })
  if (!menuId) return NextResponse.json({ error: 'menuId is required' }, { status: 400 })

  // All AI goes through OpenRouter on the platform key (src/lib/ai/openrouter.ts).
  const access = await resolveAiAccess(tenantId, 'seed_image')
  if (!access) return NextResponse.json({ error: PLATFORM_KEY_MISSING }, { status: 503 })

  // D-18: Sanitize all prompt-bound strings before interpolation (OWASP LLM #1)
  const safeBusinessType = sanitizeForPrompt(businessType)
  const safeCompanyName = sanitizeForPrompt(companyName)

  const service = await createServiceClient()

  // Fetch tenant slug for revalidatePath (D-19)
  const { data: tenant } = await service
    .from('tenants')
    .select('slug')
    .eq('id', tenantId)
    .single()

  // Fetch menu slug for revalidatePath
  const { data: menu } = await service
    .from('menus')
    .select('slug')
    .eq('id', menuId)
    .eq('tenant_id', tenantId)
    .single()

  if (!menu) return NextResponse.json({ error: 'Menu not found or does not belong to this tenant' }, { status: 404 })

  // ── image_cover (AI-07) ─────────────────────────────────────────────────────
  if (type === 'image_cover') {
    // D-11: Additive | skip if banner_url already set
    const { data: settings } = await service
      .from('tenant_settings')
      .select('banner_url')
      .eq('tenant_id', tenantId)
      .single()

    if (settings?.banner_url) {
      return NextResponse.json({ success: true, skipped: true, message: 'Banner already set. Clear it in Branding settings to re-seed.' })
    }

    let totalTokens = 0
    try {
      // D-10: Cover prompt = sanitized business_type + company_name
      // Research recommendation: include "professional restaurant photo" framing for reliability
      const prompt = `A professional, high-quality restaurant banner photo for a ${safeBusinessType || 'restaurant'} named ${safeCompanyName || 'the restaurant'}. Wide-angle view, warm ambient lighting, food photography style. Suitable as a restaurant website banner.`

      // 4:1 is the closest common ratio to BrandingClient's 3:1 recommendation (Pitfall 2)
      const result = await generateSeedImage(access, engine, prompt, '4:1')
      totalTokens = result.totalTokens
      const webpBuffer = result.webpBuffer

      // D-15: Storage path for cover = {tenant_id}/banner.webp
      const storagePath = `${tenantId}/banner.webp`
      const publicUrl = await getStorageClient().upload('tenant-assets', storagePath, webpBuffer, {
        contentType: 'image/webp',  // Pitfall 5: always set explicitly
        upsert: true,
      })

      // Write banner_url to tenant_settings
      const { error: settingsErr } = await service
        .from('tenant_settings')
        .upsert({ tenant_id: tenantId, banner_url: publicUrl }, { onConflict: 'tenant_id' })

      if (settingsErr) throw new Error(`tenant_settings update failed: ${settingsErr.message}`)
    } catch (err) {
      log.error('[seed-image] image_cover error', { err: err })
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      )
    }

    // D-17: Log ai_usage (non-blocking)
    try {
      const today = new Date().toISOString().slice(0, 10)
      await service.from('ai_usage').upsert({
        tenant_id: tenantId,
        feature_key: 'image_cover',
        date: today,
        call_count: 1,
        token_count: totalTokens,
      }, { onConflict: 'tenant_id,feature_key,date' })
    } catch (e) {
      log.error('[ai_usage] non-blocking log failed', { err: e })
    }

    // D-19: Revalidate ISR cache
    if (tenant?.slug) {
      revalidatePath(`/${tenant.slug}`)
      revalidatePath(`/${tenant.slug}/${menu.slug}`)
    }

    return NextResponse.json({ success: true, message: 'Cover image generated and uploaded.' })
  }

  // ── image_products (AI-08) ──────────────────────────────────────────────────
  if (type === 'image_products') {
    // D-13: Only products where image_url IS NULL; D-07: position order; D-20: tenant_id from URL
    const { data: products, error: prodFetchErr } = await service
      .from('products')
      .select('id, name, description')
      .eq('tenant_id', tenantId)
      .eq('menu_id', menuId)
      .is('image_url', null)
      .order('position', { ascending: true })

    if (prodFetchErr) {
      log.error('[seed-image] product fetch error', { err: prodFetchErr })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
    if (!products || products.length === 0) {
      return NextResponse.json({ success: true, imagesCreated: 0, message: 'No products need images | all already have image_url set.' })
    }

    let imagesCreated = 0
    let totalTokens = 0

    try {
      for (const product of products) {
        // D-12: Per-product prompt = business_type + product.name + sanitized description
        const safeDesc = product.description ? sanitizeForPrompt(product.description, 150) : ''
        const prompt = safeDesc
          ? `A professional food photography image of "${product.name}" | ${safeDesc}. Style: ${safeBusinessType || 'restaurant'} dish, square composition, clean background, appetizing presentation.`
          : `A professional food photography image of "${product.name}" from a ${safeBusinessType || 'restaurant'}. Square composition, clean background, appetizing presentation.`

        // Square for product cards (object-cover safe)
        const result = await generateSeedImage(access, engine, prompt, '1:1')
        totalTokens += result.totalTokens
        const webpBuffer = result.webpBuffer

        // D-15: Storage path = {tenant_id}/products/{product_id}.webp
        const storagePath = `${tenantId}/products/${product.id}.webp`
        const publicUrl = await getStorageClient().upload('tenant-assets', storagePath, webpBuffer, {
          contentType: 'image/webp',
          upsert: true,
        })

        // Pitfall 7: Write to image_url (singular), NOT image_urls (plural legacy column)
        const { error: updateErr } = await service
          .from('products')
          .update({ image_url: publicUrl })
          .eq('id', product.id)
          .eq('tenant_id', tenantId)  // Safety: never write across tenants

        if (updateErr) throw new Error(`Product image_url update failed: ${updateErr.message}`)
        imagesCreated++

        // D-17: Log ai_usage per call (non-blocking, inside loop)
        try {
          const today = new Date().toISOString().slice(0, 10)
          await service.from('ai_usage').upsert({
            tenant_id: tenantId,
            feature_key: 'image_product',
            date: today,
            call_count: 1,
            token_count: result.totalTokens,
          }, { onConflict: 'tenant_id,feature_key,date' })
        } catch (e) {
          log.error('[ai_usage] non-blocking log failed', { err: e })
        }
      }
    } catch (err) {
      log.error('[seed-image] image_products error', { err: err })
      // Return partial success info (D-07)
      return NextResponse.json(
        {
          error: 'Internal server error',
          imagesCreated,
          partial: true,
        },
        { status: 500 }
      )
    }

    // D-19: Revalidate ISR cache after all writes
    if (tenant?.slug) {
      revalidatePath(`/${tenant.slug}`)
      revalidatePath(`/${tenant.slug}/${menu.slug}`)
    }

    const plural = imagesCreated === 1 ? 'image' : 'images'
    return NextResponse.json({
      success: true,
      imagesCreated,
      tokensUsed: totalTokens,
      message: `${imagesCreated} product ${plural} generated and uploaded.`,
    })
  }

  // ── image_single_product (AI-09) ────────────────────────────────────────────
  if (type === 'image_single_product') {
    if (!productId) return NextResponse.json({ error: 'productId required for image_single_product' }, { status: 400 })

    // D-13: Additive | skip if image_url already set
    const { data: product, error: fetchErr } = await service
      .from('products')
      .select('id, name, description, image_url')
      .eq('id', productId)
      .eq('tenant_id', tenantId)  // D-20: tenant isolation enforced
      .single()

    if (fetchErr || !product) return NextResponse.json({ error: 'Product not found or does not belong to this tenant' }, { status: 404 })

    if (product.image_url) {
      return NextResponse.json({ success: true, skipped: true, message: 'Product already has an image.' })
    }

    let totalTokens = 0
    try {
      const safeDesc = product.description ? sanitizeForPrompt(product.description, 150) : ''
      const prompt = safeDesc
        ? `A professional food photography image of "${product.name}" | ${safeDesc}. Style: ${safeBusinessType || 'restaurant'} dish, square composition, clean background, appetizing presentation.`
        : `A professional food photography image of "${product.name}" from a ${safeBusinessType || 'restaurant'}. Square composition, clean background, appetizing presentation.`

      const result = await generateSeedImage(access, engine, prompt, '1:1')
      totalTokens = result.totalTokens
      const webpBuffer = result.webpBuffer

      const storagePath = `${tenantId}/products/${product.id}.webp`
      const publicUrl = await getStorageClient().upload('tenant-assets', storagePath, webpBuffer, {
        contentType: 'image/webp',
        upsert: true,
      })

      const { error: updateErr } = await service
        .from('products')
        .update({ image_url: publicUrl })
        .eq('id', product.id)
        .eq('tenant_id', tenantId)

      if (updateErr) throw new Error(`Product image_url update failed: ${updateErr.message}`)
    } catch (err) {
      log.error('[seed-image] image_single_product error', { err: err })
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      )
    }

    // D-17: Log ai_usage (non-blocking)
    try {
      const today = new Date().toISOString().slice(0, 10)
      await service.from('ai_usage').upsert({
        tenant_id: tenantId,
        feature_key: 'image_product',
        date: today,
        call_count: 1,
        token_count: totalTokens,
      }, { onConflict: 'tenant_id,feature_key,date' })
    } catch (e) {
      log.error('[ai_usage] non-blocking log failed', { err: e })
    }

    // D-19: Revalidate ISR cache
    if (tenant?.slug) {
      revalidatePath(`/${tenant.slug}`)
      revalidatePath(`/${tenant.slug}/${menu.slug}`)
    }

    return NextResponse.json({ success: true, message: 'Product image generated and uploaded.' })
  }

  return NextResponse.json({ error: `Unknown image seed type: ${type}` }, { status: 400 })
}

export const POST = withApi('POST /api/superadmin/tenants/[id]/seed-image', handlePOST)
