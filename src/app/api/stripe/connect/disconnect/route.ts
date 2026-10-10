/**
 * Stripe Connect disconnect endpoint
 * 
 * Phase 32: Deactivates a tenant's Stripe connection
 * POST /api/stripe/connect/disconnect
 */

import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { stripe } from '@/lib/stripe'

export async function POST() {
  // 1. Authenticate and get tenant (cookie client, used only for the
  // identity check).
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const effective = await getEffectiveTenant()
  if (!effective) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 2. Soft-delete via the service client. Round-2 P0-07: stripe_connections
  // has only SELECT policies — there is no UPDATE policy for authenticated
  // role, so the previous cookie-client write was silently denied by RLS.
  // The tenant ownership check above already authorized this action.
  const service = await createServiceClient()
  const { data, error } = await service
    .from('stripe_connections')
    .update({
      is_active: false,
      disconnected_at: new Date().toISOString(),
    })
    .eq('tenant_id', effective.tenantId)
    .eq('is_active', true)
    .select('id, stripe_account_id')
    .single()

  if (error) {
    console.error('[Stripe Disconnect] DB update failed:', error)
    return NextResponse.json({ error: 'Failed to disconnect Stripe account' }, { status: 500 })
  }

  // 3. Actually revoke the platform's OAuth authorization on Stripe's side.
  // Without this the connection is only soft-deleted locally while the platform
  // retains full charge authority on the tenant's account. Best-effort: a
  // failure here must not block the local disconnect.
  if (data?.stripe_account_id && process.env.STRIPE_CLIENT_ID) {
    try {
      await stripe.oauth.deauthorize({
        client_id: process.env.STRIPE_CLIENT_ID,
        stripe_user_id: data.stripe_account_id,
      })
    } catch (deauthErr) {
      console.error('[Stripe Disconnect] OAuth deauthorize failed (soft-deleted locally):', deauthErr)
    }
  }

  // 4. Return success
  const disconnected = !!data
  return NextResponse.json({
    success: true,
    disconnected,
  })
}