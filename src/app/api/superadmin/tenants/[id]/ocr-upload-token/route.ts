import { assertSuperadmin } from '@/lib/superadmin-auth'
import { getStorageClient } from '@/lib/storage'
import { NextResponse } from 'next/server'

// GET /api/superadmin/tenants/[id]/ocr-upload-token?filename=menu.jpg
// Returns { uploadUrl, storagePath } for direct browser upload to storage.
// Bypasses Vercel 4.5 MB serverless body limit (PITFALLS.md Pitfall 4, D-01).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tenantId } = await params

  // D-18: Auth guard — assertSuperadmin() first on every new route
  const supabase = await assertSuperadmin()
  if (!supabase) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // D-02: Storage bucket = tenant-assets, path = {tenant_id}/ocr/{timestamp}[-{ext}]
  // Accept optional filename query param for extension tracking (Pitfall 7 mitigation)
  const { searchParams } = new URL(request.url)
  const filename = searchParams.get('filename') ?? 'menu'
  const ext = filename.includes('.') ? filename.split('.').pop() : 'jpg'
  const timestamp = Date.now()
  const storagePath = `${tenantId}/ocr/${timestamp}.${ext}`

  try {
    const { url, token } = await getStorageClient().createSignedUploadUrl('tenant-assets', storagePath)

    // Return uploadUrl + storagePath; token included for Supabase provider compatibility
    return NextResponse.json({
      uploadUrl: url,
      storagePath,
      ...(token !== undefined ? { token } : {}),
    })
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to create upload URL: ${err instanceof Error ? err.message : 'Unknown error'}` },
      { status: 500 }
    )
  }
}
