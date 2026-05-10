import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { createServiceClient } from '@/lib/supabase/server'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const effective = await getEffectiveTenant()
  const { tenantId } = effective!

  if (tenantId !== id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { custom_domain, custom_domain_verified, force_verified } = body

  const updates: Record<string, unknown> = {}

  if (typeof custom_domain === 'string') {
    updates.custom_domain = custom_domain.trim() === '' ? null : custom_domain.trim().toLowerCase()
    updates.custom_domain_verified = false
  }

  if (typeof custom_domain_verified === 'boolean' || force_verified === true) {
    updates.custom_domain_verified = true
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
  }

  const supabase = await createServiceClient()
  const { data, error } = await supabase
    .from('tenants')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ tenant: data })
}
