/**
 * Stripe Connect OAuth initiation endpoint
 * 
 * Phase 32: Redirects to Stripe OAuth flow
 * GET /api/stripe/connect/oauth
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { getTenantCapabilities } from '@/lib/tenant-plan'
import { signOAuthState } from '@/lib/stripe-oauth-state'
import { withApi } from '@/lib/observability/with-api'

function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
}

async function handleGET() {
  // 1. Authenticate and get tenant
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.redirect(new URL('/auth/login', getBaseUrl()))
  }

  const effective = await getEffectiveTenant()
  if (!effective) {
    return NextResponse.json({ error: 'Unauthorized - no tenant context' }, { status: 401 })
  }
  // Connecting a payout account is the owner's call, never staff's.
  if (effective.role !== 'store-admin' && effective.role !== 'superadmin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // 2. Verify the plan includes Stripe Connect (only the plan matters here).
  const capabilities = await getTenantCapabilities(effective.tenantId, null)
  if (!capabilities.plan.stripe) {
    return NextResponse.redirect(new URL(`${getBaseUrl()}/settings/store?stripe=feature_not_available`))
  }

  // 3. Check if already connected
  const { data: existingConnection } = await supabase
    .from('stripe_connections')
    .select('stripe_account_id')
    .eq('tenant_id', effective.tenantId)
    .eq('is_active', true)
    .single()

  if (existingConnection) {
    return NextResponse.redirect(new URL(`${getBaseUrl()}/settings/store?stripe=already_connected`))
  }

  // 4. Check required env vars
  const clientId = process.env.STRIPE_CLIENT_ID
  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!clientId || !secretKey) {
    console.error('[Stripe OAuth] Missing STRIPE_CLIENT_ID or STRIPE_SECRET_KEY')
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 })
  }

  // 5. Build OAuth URL
  const redirectUri = `${getBaseUrl()}/api/stripe/connect/callback`

  // P1-01 fix: state is now HMAC-signed and timestamp-bound. The callback
  // verifies the signature before trusting the tenantId.
  const state = signOAuthState(effective.tenantId)

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope: 'read_write',
    redirect_uri: redirectUri,
    state,
  })

  const stripeOAuthUrl = `https://connect.stripe.com/oauth/authorize?${params.toString()}`

  return NextResponse.redirect(new URL(stripeOAuthUrl))
}

export const GET = withApi('GET /api/stripe/connect/oauth', handleGET)