import { createServiceClient } from '@/lib/supabase/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'

export async function GET() {
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const service = await createServiceClient()
  const { data, error } = await service.from('platform_settings').select('*').single()
  if (error) {
    console.error('GET /api/superadmin/settings:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
  return NextResponse.json(data)
}

export async function PATCH(request: Request) {
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const service = await createServiceClient()

  const allowed = ['app_name', 'brand_name', 'default_primary_color', 'default_accent_color', 'cta_color', 'menu_footer_brand', 'landing', 'seo_title', 'seo_description', 'favicon_url', 'legal']
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
    if (error) {
      console.error('PATCH /api/superadmin/settings:', error)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
    result = data
  } else {
    const { data, error } = await service
      .from('platform_settings')
      .insert(update)
      .select()
      .single()
    if (error) {
      console.error('PATCH /api/superadmin/settings:', error)
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
    result = data
  }

  revalidatePath('/', 'page')
  // /terms and /privacy read platform_settings.legal and are ISR-cached, so
  // without this a published document would not appear until the 60s window
  // elapsed — which reads as "saving is broken" to whoever just clicked Save.
  if ('legal' in update) {
    revalidatePath('/terms', 'page')
    revalidatePath('/privacy', 'page')
  }

  return NextResponse.json(result)
}
