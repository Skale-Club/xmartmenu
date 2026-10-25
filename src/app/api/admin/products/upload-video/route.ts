/**
 * POST multipart { file } — a dish video. Re-encoded to a light MP4 (720p,
 * no audio, fast start) with a WebP poster (src/lib/media/video.ts), stored
 * in the product-images bucket. Returns { url, poster_url, bytes, original_bytes }.
 */
import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { getStorageClient } from '@/lib/storage'
import { convertBufferToWebP } from '@/lib/upload'
import { ALLOWED_VIDEO_TYPES, MAX_VIDEO_UPLOAD_BYTES, transcodeVideo } from '@/lib/media/video'
import { rateLimit } from '@/lib/rate-limit'
import { withApi } from '@/lib/observability/with-api'
import { log } from '@/lib/observability/log'

export const runtime = 'nodejs'
export const maxDuration = 300

async function handlePOST(request: Request) {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (effective.role === 'store-staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const limited = await rateLimit('video-upload', effective.tenantId, 20, '1 h')
  if (!limited.ok) return NextResponse.json({ error: 'Too many video uploads. Try again later.' }, { status: 429 })

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'No video received' }, { status: 400 })
  if (!ALLOWED_VIDEO_TYPES.includes(file.type)) return NextResponse.json({ error: 'Unsupported video. Use MP4, MOV or WebM.' }, { status: 400 })
  if (file.size > MAX_VIDEO_UPLOAD_BYTES) {
    return NextResponse.json({ error: `Video is too large (max ${MAX_VIDEO_UPLOAD_BYTES / 1024 / 1024} MB).` }, { status: 413 })
  }

  try {
    const result = await transcodeVideo(Buffer.from(await file.arrayBuffer()), file.type)
    const base = `${effective.tenantId}/videos/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const storage = getStorageClient()
    const url = await storage.upload('product-images', `${base}.${result.contentType === 'video/webm' ? 'webm' : 'mp4'}`, result.video, { contentType: result.contentType, upsert: true })
    const posterUrl = result.poster
      ? await storage.upload('product-images', `${base}-poster.webp`, await convertBufferToWebP(result.poster), { contentType: 'image/webp', upsert: true })
      : null
    log.info('video.uploaded', { tenant_id: effective.tenantId, original_bytes: file.size, bytes: result.video.length, transcoded: result.transcoded })
    return NextResponse.json({ url, poster_url: posterUrl, bytes: result.video.length, original_bytes: file.size, transcoded: result.transcoded })
  } catch (err) {
    log.error('POST /api/admin/products/upload-video', { err })
    return NextResponse.json({ error: 'Could not process this video. Try a shorter clip or another format.' }, { status: 422 })
  }
}

export const POST = withApi('POST /api/admin/products/upload-video', handlePOST)
