import { createServiceClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { NextResponse } from 'next/server'

export async function GET() {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = await createServiceClient()
  const { data, error } = await service
    .from('locations')
    .select('*')
    .eq('tenant_id', effective.tenantId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error('GET /api/admin/locations:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
  return NextResponse.json(data ?? [])
}

export async function POST(request: Request) {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (effective.role === 'store-staff') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { name, slug, address, city, phone, business_hours, menu_id,
          region, postal_code, country, latitude, longitude } = body

  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!slug?.trim()) return NextResponse.json({ error: 'Slug is required' }, { status: 400 })
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return NextResponse.json({ error: 'Slug must be lowercase letters, numbers, and hyphens only' }, { status: 400 })
  }

  const coord = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

  const service = await createServiceClient()
  const { data, error } = await service
    .from('locations')
    .insert({
      tenant_id: effective.tenantId,
      name: name.trim(),
      slug: slug.trim(),
      address: address?.trim() || null,
      city: city?.trim() || null,
      phone: phone?.trim() || null,
      business_hours: business_hours || null,
      menu_id: menu_id ?? null,
      region: region?.trim() || null,
      postal_code: postal_code?.trim() || null,
      country: country?.trim() || null,
      latitude: coord(latitude),
      longitude: coord(longitude),
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A location with this slug already exists' }, { status: 409 })
    }
    console.error('POST /api/admin/locations:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
  return NextResponse.json(data, { status: 201 })
}
