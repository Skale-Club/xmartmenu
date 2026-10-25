import { createServiceClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { NextResponse } from 'next/server'
import { sanitizeTranslations } from '@/lib/menu-translations'
import { parseCourse } from '@/components/menu/upsell'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (effective.role === 'store-staff') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const service = await createServiceClient()
  const allowed = ['name', 'description', 'position', 'is_active']
  const update: Record<string, unknown> = {}
  for (const key of allowed) if (key in body) update[key] = body[key]
  if ('translations' in body) update.translations = sanitizeTranslations(body.translations)
  if ('course' in body) update.course = parseCourse(body.course)

  const { data, error } = await service
    .from('categories')
    .update(update)
    .eq('id', id)
    .eq('tenant_id', effective.tenantId)
    .select()
    .single()

  if (error) {
    console.error('PATCH /api/admin/categories/[id]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
  return NextResponse.json(data)
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (effective.role === 'store-staff') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const service = await createServiceClient()
  const { error } = await service
    .from('categories')
    .delete()
    .eq('id', id)
    .eq('tenant_id', effective.tenantId)

  if (error) {
    console.error('DELETE /api/admin/categories/[id]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
