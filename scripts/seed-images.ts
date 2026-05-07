/**
 * Phase 10 — Image Seeding Script (GH Actions)
 *
 * Plain Node.js script (no @/ aliases — not a Next.js context).
 * Invoked by .github/workflows/image-seeding.yml via:
 *   npx tsx scripts/seed-images.ts
 *
 * Pipeline:
 *   ai_jobs.status = 'running'
 *     → optional cover photo (16:9) when PRODUCT_ID is empty and tenant has no banner_url
 *     → product photos (1:1) for each product without image_url (single product if PRODUCT_ID set)
 *     → ai_usage upsert (feature_key='image_seeding', call_count=imagesGenerated)
 *     → POST /api/revalidate (Pattern 8 — GH Actions cannot call revalidatePath directly)
 *   ai_jobs.status = 'complete' | 'failed'
 *
 * Sequential generation with 1500ms delay between calls (Pitfall 5 — preview-model rate limits).
 */

import { GoogleGenAI } from '@google/genai'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'

// ----- Inlined sanitizeForPrompt (D-14) -----
// Mirrors src/lib/ai/sanitize.ts. Inlined because this script does NOT use @/ aliases.
function sanitizeForPrompt(str: string, maxLength = 100): string {
  return str
    .replace(/[`{}<>\n\r]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

// ----- Env vars -----
const JOB_ID = process.env.JOB_ID ?? ''
const TENANT_ID = process.env.TENANT_ID ?? ''
const PRODUCT_ID = process.env.PRODUCT_ID ?? '' // empty string = bulk
const GOOGLE_GENERATIVE_AI_API_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? ''
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const VERCEL_REVALIDATE_URL = process.env.VERCEL_REVALIDATE_URL ?? ''
const VERCEL_REVALIDATE_SECRET = process.env.VERCEL_REVALIDATE_SECRET ?? ''

// ----- Constants -----
const MODEL_NAME = 'gemini-3.1-flash-image-preview'
const STORAGE_BUCKET = 'tenant-assets'
const FEATURE_KEY = 'image_seeding'
const RATE_LIMIT_DELAY_MS = 1500

// ----- Types -----
interface TenantRow {
  id: string
  name: string | null
  slug: string | null
  tenant_settings: { business_type: string | null; banner_url: string | null } | null
}

interface ProductRow {
  id: string
  name: string | null
  category_id: string | null
  image_url: string | null
}

// ----- Supabase service client (bypasses RLS) -----
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ----- Gemini client -----
const ai = new GoogleGenAI({ apiKey: GOOGLE_GENERATIVE_AI_API_KEY })

// ----- Helpers -----
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function generateAndUploadImage(
  prompt: string,
  storagePath: string,
  aspectRatio: '16:9' | '1:1',
): Promise<string> {
  // Pitfall 4: imageSize is silently ignored — configure aspectRatio only.
  const response = await ai.models.generateContent({
    model: MODEL_NAME,
    contents: prompt,
    config: {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio },
    },
  })

  const parts = response?.candidates?.[0]?.content?.parts ?? []
  const inlinePart = parts.find((p) => p?.inlineData?.data)
  const base64 = inlinePart?.inlineData?.data

  if (!base64) {
    throw new Error(
      `Gemini ${MODEL_NAME} returned no inlineData for storagePath=${storagePath}`,
    )
  }

  const pngBuffer = Buffer.from(base64, 'base64')
  const webpBuffer = await sharp(pngBuffer).webp({ quality: 85 }).toBuffer()

  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, webpBuffer, {
      contentType: 'image/webp',
      upsert: true,
    })

  if (uploadError) {
    throw new Error(`Storage upload failed for ${storagePath}: ${uploadError.message}`)
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath)

  return publicUrl
}

async function logAiUsage(callCount: number): Promise<void> {
  if (callCount <= 0) return
  const today = new Date().toISOString().slice(0, 10)
  await supabase.from('ai_usage').upsert(
    {
      tenant_id: TENANT_ID,
      feature_key: FEATURE_KEY,
      date: today,
      call_count: callCount,
      token_count: 0, // Gemini image generation does not return token counts
    },
    { onConflict: 'tenant_id,feature_key,date' },
  )
}

async function callRevalidate(tenantSlug: string | null): Promise<void> {
  if (!VERCEL_REVALIDATE_URL || !VERCEL_REVALIDATE_SECRET) {
    console.warn('[seed-images] Skipping revalidate: missing VERCEL_REVALIDATE_URL/SECRET')
    return
  }
  if (!tenantSlug) {
    console.warn('[seed-images] Skipping revalidate: tenant slug missing')
    return
  }

  try {
    const res = await fetch(`${VERCEL_REVALIDATE_URL}/api/revalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: VERCEL_REVALIDATE_SECRET,
        tenantSlug,
      }),
    })
    if (!res.ok) {
      console.warn(
        `[seed-images] Revalidate endpoint returned ${res.status} ${res.statusText}`,
      )
    }
  } catch (err) {
    console.warn(
      `[seed-images] Revalidate fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

// ----- Main -----
async function main(): Promise<void> {
  if (!JOB_ID || !TENANT_ID) {
    throw new Error('Missing required env vars: JOB_ID, TENANT_ID')
  }
  if (!GOOGLE_GENERATIVE_AI_API_KEY) {
    throw new Error('Missing GOOGLE_GENERATIVE_AI_API_KEY')
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  // 1. Mark job as running
  await supabase.from('ai_jobs').update({ status: 'running' }).eq('id', JOB_ID)

  // 2. Fetch tenant + tenant_settings
  const { data: tenantData, error: tenantErr } = await supabase
    .from('tenants')
    .select('id, name, slug, tenant_settings(business_type, banner_url)')
    .eq('id', TENANT_ID)
    .single()

  if (tenantErr || !tenantData) {
    throw new Error(
      `Failed to load tenant ${TENANT_ID}: ${tenantErr?.message ?? 'not found'}`,
    )
  }

  const tenant = tenantData as unknown as TenantRow
  const settings = tenant.tenant_settings ?? null
  const businessType = settings?.business_type ?? ''
  const existingBannerUrl = settings?.banner_url ?? null

  const safeCompanyName = sanitizeForPrompt(tenant.name ?? '')
  const safeBusinessType = sanitizeForPrompt(businessType)

  let imagesGenerated = 0
  const isBulk = PRODUCT_ID.trim().length === 0

  // 3. Cover photo (only on bulk runs and only when no existing banner)
  if (isBulk) {
    if (existingBannerUrl) {
      console.log('[seed-images] Skipping cover — tenant already has banner_url')
    } else {
      const businessLabel = safeBusinessType || 'restaurant'
      const coverPrompt =
        `Professional food and hospitality photography. ` +
        `Restaurant interior of a ${businessLabel} named ${safeCompanyName}. ` +
        `Warm, inviting atmosphere. Soft natural lighting, bokeh background. ` +
        `No people, no text, no logos.`

      const coverPath = `${TENANT_ID}/cover.webp`
      const coverUrl = await generateAndUploadImage(coverPrompt, coverPath, '16:9')

      await supabase
        .from('tenant_settings')
        .upsert(
          { tenant_id: TENANT_ID, banner_url: coverUrl },
          { onConflict: 'tenant_id' },
        )

      imagesGenerated += 1
      console.log(`[seed-images] Cover uploaded: ${coverUrl}`)

      // Delay before processing products (Pitfall 5)
      await sleep(RATE_LIMIT_DELAY_MS)
    }
  }

  // 4. Products
  let productsQuery = supabase
    .from('products')
    .select('id, name, category_id, image_url')
    .eq('tenant_id', TENANT_ID)

  if (isBulk) {
    productsQuery = productsQuery.is('image_url', null)
  } else {
    productsQuery = productsQuery.eq('id', PRODUCT_ID)
  }

  const { data: productsData, error: productsErr } = await productsQuery

  if (productsErr) {
    throw new Error(`Failed to load products: ${productsErr.message}`)
  }

  const products = (productsData ?? []) as ProductRow[]
  console.log(`[seed-images] Products to process: ${products.length}`)

  // Sequential — NO Promise.all (Pitfall 5)
  for (let i = 0; i < products.length; i++) {
    const product = products[i]

    // Skip products with existing image_url even when single-product mode
    // (defensive — additive only per D-09)
    if (!isBulk && product.image_url) {
      console.log(
        `[seed-images] Skipping product ${product.id} — already has image_url`,
      )
      continue
    }

    // Fetch category name (best effort)
    let categoryName = ''
    if (product.category_id) {
      const { data: cat } = await supabase
        .from('categories')
        .select('name')
        .eq('id', product.category_id)
        .single()
      categoryName = cat?.name ?? ''
    }

    const safeProductName = sanitizeForPrompt(product.name ?? '')
    const safeCategoryName = sanitizeForPrompt(categoryName)
    const businessLabel = safeBusinessType || 'restaurant'

    const productPrompt =
      `Professional food photography. ` +
      `A dish called "${safeProductName}" from the "${safeCategoryName}" section ` +
      `of a ${businessLabel} restaurant. ` +
      `Close-up, top-down or 45-degree angle, clean white plate, soft natural lighting. ` +
      `Food only. No people, no text, no logos, no watermarks.`

    const productPath = `${TENANT_ID}/products/${product.id}.webp`
    const productUrl = await generateAndUploadImage(productPrompt, productPath, '1:1')

    const { error: updateErr } = await supabase
      .from('products')
      .update({ image_url: productUrl })
      .eq('id', product.id)

    if (updateErr) {
      throw new Error(
        `Failed to update product ${product.id}: ${updateErr.message}`,
      )
    }

    imagesGenerated += 1
    console.log(
      `[seed-images] Product ${product.id} (${i + 1}/${products.length}) uploaded: ${productUrl}`,
    )

    // Delay between product calls (Pitfall 5) — skip after last one
    if (i < products.length - 1) {
      await sleep(RATE_LIMIT_DELAY_MS)
    }
  }

  // 5. ai_usage logging (non-blocking on failure)
  try {
    await logAiUsage(imagesGenerated)
  } catch (err) {
    console.warn(
      `[seed-images] ai_usage upsert failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  // 6. Revalidate public menu cache
  await callRevalidate(tenant.slug)

  // 7. Mark job complete
  await supabase
    .from('ai_jobs')
    .update({ status: 'complete', completed_at: new Date().toISOString() })
    .eq('id', JOB_ID)

  console.log(
    `[seed-images] Complete. Images generated: ${imagesGenerated}. job_id=${JOB_ID}`,
  )
}

main().catch(async (err) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`[seed-images] FAILED: ${message}`)

  if (JOB_ID) {
    try {
      await supabase
        .from('ai_jobs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: message,
        })
        .eq('id', JOB_ID)
    } catch (updateErr) {
      console.error(
        `[seed-images] Failed to mark job failed: ${updateErr instanceof Error ? updateErr.message : String(updateErr)}`,
      )
    }
  }

  process.exit(1)
})
