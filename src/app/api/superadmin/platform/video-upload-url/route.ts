import { NextResponse } from 'next/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { getStorageClient } from '@/lib/storage'

export async function GET() {
  if (!(await assertSuperadmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const storage = getStorageClient()
  const bucket = 'tenant-assets'
  const path = '_platform/hero-bg-video.mp4'

  try {
    // Presigned PUT: the browser uploads straight to storage, bypassing the
    // serverless body limit. Works for both providers — the client sends a plain
    // PUT with Content-Type, which Supabase signed URLs and R2 both accept.
    const { url } = await storage.createSignedUploadUrl(bucket, path)
    const publicUrl = storage.getPublicUrl(bucket, path)

    return NextResponse.json({ signedUrl: url, path, publicUrl })
  } catch (err) {
    console.error('GET /api/superadmin/platform/video-upload-url:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
