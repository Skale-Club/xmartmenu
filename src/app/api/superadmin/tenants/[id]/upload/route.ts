import { createServiceClient } from '@/lib/supabase/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { NextResponse } from 'next/server'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await request.formData()
  const file = formData.get('file') as File | null
  const type = formData.get('type') as string | null

  if (!file || !type) return NextResponse.json({ error: 'Arquivo ou tipo inválido' }, { status: 400 })

  const ext = file.name.split('.').pop()
  const bucket = type === 'logo' ? 'tenant-assets' : 'tenant-assets'
  const filename = `${id}/${type}.${ext}`

  const service = await createServiceClient()
  const { data, error } = await service.storage
    .from(bucket)
    .upload(filename, file, { upsert: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: { publicUrl } } = service.storage.from(bucket).getPublicUrl(data.path)
  return NextResponse.json({ url: publicUrl })
}
