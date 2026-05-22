import { createServiceClient } from '@/lib/supabase/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { NextResponse } from 'next/server'

export async function GET() {
  const service = await createServiceClient()
  const { data, error } = await service.from('platform_settings').select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(request: Request) {
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const service = await createServiceClient()

  const allowed = ['app_name', 'brand_name', 'default_primary_color', 'default_accent_color', 'cta_color', 'menu_footer_brand', 'landing', 'seo_title', 'seo_description']
  const update: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) update[key] = body[key]
  }

  const { data: existing } = await service.from('platform_settings').select('id').single()

  let result
  if (existing) {
    const { data, error } = await service
      .from('platform_settings')
      .update(update)
      .eq('id', existing.id)
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    result = data
  } else {
    const { data, error } = await service
      .from('platform_settings')
      .insert(update)
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    result = data
  }

  return NextResponse.json(result)
}
