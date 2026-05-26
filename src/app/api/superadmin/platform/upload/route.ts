import { NextResponse } from 'next/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { createServiceClient } from '@/lib/supabase/server'
import { validateAndConvertToWebP } from '@/lib/upload'

const MAX_VIDEO_SIZE = 50 * 1024 * 1024 // 50MB
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime']

export const maxDuration = 60

export async function POST(request: Request) {
  try {
  if (!(await assertSuperadmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const form = await request.formData()
  const file = form.get('file') as File | null
  const type = form.get('type') as string | null // 'image' | 'video'

  if (!file || !type) {
    return NextResponse.json({ error: 'file and type required' }, { status: 400 })
  }

  const service = await createServiceClient()
  const bucket = 'tenant-assets'

  if (type === 'image') {
    const result = await validateAndConvertToWebP(file)
    if (result.error) return NextResponse.json({ error: result.error }, { status: 400 })

    const dest = form.get('dest') as string | null
    const path = dest === 'cta-bg'
      ? '_platform/cta-bg.webp'
      : dest === 'favicon'
        ? '_platform/favicon.webp'
        : '_platform/hero-bg-image.webp'
    const { error } = await service.storage
      .from(bucket)
      .upload(path, result.buffer!, {
        contentType: 'image/webp',
        upsert: true,
      })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const { data: { publicUrl } } = service.storage.from(bucket).getPublicUrl(path)
    // Bust cache by appending timestamp so browser re-fetches after replace.
    return NextResponse.json({ url: `${publicUrl}?v=${Date.now()}` })
  }

  if (type === 'video') {
    console.log('[upload] video upload attempt:', { name: file.name, size: file.size, mimeType: file.type })
    if (file.size > MAX_VIDEO_SIZE) {
      return NextResponse.json({ error: `Video too large (max 50MB, got ${(file.size / 1024 / 1024).toFixed(1)}MB)` }, { status: 400 })
    }
    if (!ALLOWED_VIDEO_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Unsupported video format. Use MP4, WebM or MOV.' }, { status: 400 })
    }

    const ext = file.type === 'video/webm' ? 'webm' : 'mp4'
    const path = `_platform/hero-bg-video.${ext}`
    const bytes = await file.arrayBuffer()

    const { error } = await service.storage
      .from(bucket)
      .upload(path, Buffer.from(bytes), {
        contentType: file.type,
        upsert: true,
      })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const { data: { publicUrl } } = service.storage.from(bucket).getPublicUrl(path)
    return NextResponse.json({ url: `${publicUrl}?v=${Date.now()}` })
  }

  return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  } catch (err) {
    console.error('[upload] unhandled error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Upload failed' }, { status: 500 })
  }
}
