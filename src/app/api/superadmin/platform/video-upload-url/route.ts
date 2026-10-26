import { NextResponse } from 'next/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { getStorageClient } from '@/lib/storage'
import { withApi } from '@/lib/observability/with-api'
import { log } from '@/lib/observability/log'
import { HERO_VIDEO_BUCKET, heroSourcePath } from '@/lib/media/hero-video'

async function handleGET(request: Request) {
  if (!(await assertSuperadmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // The raw file goes to a staging key; POST /platform/hero-video then
  // encodes it with the hero profile into the published key.
  const mimeType = new URL(request.url).searchParams.get('type') ?? 'video/mp4'
  const path = heroSourcePath(mimeType)
  if (!path) {
    return NextResponse.json({ error: 'Unsupported video format. Use MP4, WebM or MOV.' }, { status: 400 })
  }
  const storage = getStorageClient()
  const bucket = HERO_VIDEO_BUCKET

  try {
    // Presigned PUT: the browser uploads straight to storage, bypassing the
    // serverless body limit. Works for both providers — the client sends a plain
    // PUT with Content-Type, which Supabase signed URLs and R2 both accept.
    const { url } = await storage.createSignedUploadUrl(bucket, path)
    const publicUrl = storage.getPublicUrl(bucket, path)

    return NextResponse.json({ signedUrl: url, path, publicUrl })
  } catch (err) {
    log.error('GET /api/superadmin/platform/video-upload-url', { err: err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const GET = withApi('GET /api/superadmin/platform/video-upload-url', handleGET)
