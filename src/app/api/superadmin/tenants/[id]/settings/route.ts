import { createServiceClient } from '@/lib/supabase/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { NextResponse } from 'next/server'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = await createServiceClient()
  const { data: tenant } = await service.from('tenants').select('*').eq('id', id).single()
  const { data: settings } = await service.from('tenant_settings').select('*').eq('tenant_id', id).single()

  return NextResponse.json({ tenant, settings })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()

  // Allowlist tenant_settings columns (tenant_id is forced; id/updated_at are
  // managed) so a raw body cannot mass-assign arbitrary/typed columns.
  const ALLOWED_FIELDS = [
    'logo_url', 'primary_color', 'accent_color', 'banner_url', 'address', 'phone',
    'instagram', 'whatsapp', 'business_hours', 'custom_tags', 'orders_enabled',
    'direct_orders_enabled', 'currency', 'language', 'whatsapp_orders_enabled',
    'item_notes_enabled', 'ingredient_customization_enabled', 'amber_threshold_minutes',
    'red_threshold_minutes', 'business_type', 'tagline', 'about', 'dine_in_enabled',
    'pickup_enabled', 'delivery_enabled', 'pickup_eta_minutes', 'delivery_fee_cents',
    'tips_enabled', 'tip_percentage_1', 'tip_percentage_2', 'tip_percentage_3',
    'table_management_enabled',
  ] as const
  const update: Record<string, unknown> = {}
  for (const key of ALLOWED_FIELDS) {
    if (key in body) update[key] = body[key]
  }

  // Validate color fields — they are interpolated into <style> downstream.
  const HEX = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
  for (const colorKey of ['primary_color', 'accent_color'] as const) {
    if (colorKey in update && (typeof update[colorKey] !== 'string' || !HEX.test((update[colorKey] as string).trim()))) {
      return NextResponse.json({ error: `Invalid ${colorKey}` }, { status: 400 })
    }
  }

  const service = await createServiceClient()

  const { data, error } = await service
    .from('tenant_settings')
    .upsert({ ...update, tenant_id: id }, { onConflict: 'tenant_id' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
