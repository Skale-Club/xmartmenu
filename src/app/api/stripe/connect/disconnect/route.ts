/**
 * Stripe Connect disconnect endpoint
 * 
 * Phase 32: Deactivates a tenant's Stripe connection
 * POST /api/stripe/connect/disconnect
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'

export async function POST() {
  // 1. Authenticate and get tenant
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const effective = await getEffectiveTenant()
  if (!effective) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Soft-delete the Stripe connection (set is_active = false)
  const { data, error } = await supabase
    .from('stripe_connections')
    .update({
      is_active: false,
      disconnected_at: new Date().toISOString(),
    })
    .eq('tenant_id', effective.tenantId)
    .eq('is_active', true)
    .select('id')
    .single()

  if (error) {
    console.error('[Stripe Disconnect] DB update failed:', error)
    return NextResponse.json({ error: 'Failed to disconnect Stripe account' }, { status: 500 })
  }

  // 3. Return success
  const disconnected = !!data
  return NextResponse.json({
    success: true,
    disconnected,
  })
}