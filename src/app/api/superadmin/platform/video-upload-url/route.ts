import { NextResponse } from 'next/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET() {
  if (!(await assertSuperadmin())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const service = createServiceClient()
  const bucket = 'tenant-assets'
  const path = '_platform/hero-bg-video.mp4'

  const { data, error } = await service.storage
    .from(bucket)
    .createSignedUploadUrl(path)

  if (error || !data) {
    console.error('GET /api/superadmin/platform/video-upload-url:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  const { data: { publicUrl } } = service.storage.from(bucket).getPublicUrl(path)

  return NextResponse.json({ signedUrl: data.signedUrl, path, publicUrl })
}
