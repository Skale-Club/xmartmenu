/**
 * POST multipart { file, format } — a dish's 3D model for augmented reality.
 * format = 'glb' (the model, required for AR) or 'usdz' (optional iOS file).
 *
 * The bytes are checked (src/lib/ar/model-file.ts), stored as-is in the
 * product-images bucket under {tenant}/ar/ with the right Content-Type, and
 * the public URL returned. The back office then writes product_ar_models.
 * Returns { url, storage_path, bytes, heavy }.
 */
import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { getStorageClient } from '@/lib/storage'
import { AR_MODEL_CONTENT_TYPES, MAX_AR_MODEL_BYTES, arModelStoragePath, checkArModelFile, type ArModelFormat } from '@/lib/ar/model-file'
import { rateLimit } from '@/lib/rate-limit'
import { withApi } from '@/lib/observability/with-api'
import { log } from '@/lib/observability/log'

export const runtime = 'nodejs'
export const maxDuration = 120

async function handlePOST(request: Request) {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (effective.role === 'store-staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const limited = await rateLimit('ar-model-upload', effective.tenantId, 30, '1 h')
  if (!limited.ok) return NextResponse.json({ error: 'Too many 3D model uploads. Try again later.' }, { status: 429 })

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  const formatField = form?.get('format')
  const format: ArModelFormat | null = formatField === 'glb' || formatField === 'usdz' ? formatField : null
  if (!format) return NextResponse.json({ error: 'Missing format (glb or usdz)' }, { status: 400 })
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file received' }, { status: 400 })
  if (file.size > MAX_AR_MODEL_BYTES) {
    return NextResponse.json({ error: `The 3D model is too large (max ${MAX_AR_MODEL_BYTES / 1024 / 1024} MB).` }, { status: 413 })
  }

  const data = new Uint8Array(await file.arrayBuffer())
  const check = checkArModelFile(data, format)
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 })

  const storagePath = arModelStoragePath(effective.tenantId, format)
  try {
    const url = await getStorageClient().upload('product-images', storagePath, data, {
      contentType: AR_MODEL_CONTENT_TYPES[format],
      upsert: true,
    })
    log.info('ar_model.uploaded', { tenant_id: effective.tenantId, format, bytes: check.bytes, heavy: check.heavy })
    return NextResponse.json({ url, storage_path: storagePath, bytes: check.bytes, heavy: check.heavy })
  } catch (err) {
    log.error('POST /api/admin/products/upload-ar-model', { err })
    return NextResponse.json({ error: 'Could not store the 3D model. Try again.' }, { status: 500 })
  }
}

export const POST = withApi('POST /api/admin/products/upload-ar-model', handlePOST)
