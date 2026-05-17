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
  const { custom_domain } = body

  const updates: Record<string, unknown> = {}

  if (typeof custom_domain === 'string') {
    updates.custom_domain = custom_domain.trim() === '' ? null : custom_domain.trim().toLowerCase()
    // Always reset verification when the domain is (re-)set. Verification is
    // only ever flipped to true server-side from the /verify-domain endpoint
    // after a real DNS check — never via this body.
    updates.custom_domain_verified = false
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
