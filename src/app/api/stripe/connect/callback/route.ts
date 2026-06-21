/**
 * Stripe Connect OAuth callback endpoint
 *
 * Phase 32: Handles OAuth callback from Stripe
 * GET /api/stripe/connect/callback?code=xxx&state=yyy
 */

import { NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { createServiceClient } from '@/lib/supabase/server'
import { verifyOAuthState } from '@/lib/stripe-oauth-state'
import { enqueueXphereSync } from '@/lib/xphere/queue'

function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const state = searchParams.get('state')

  const redirectUrl = `${getBaseUrl()}/settings/store`

  // 1. Check for Stripe error (user denied)
  if (error === 'access_denied') {
    return NextResponse.redirect(new URL(`${redirectUrl}?stripe=access_denied`))
  }

  // 2. Validate code present
  if (!code) {
    return NextResponse.redirect(new URL(`${redirectUrl}?stripe=missing_code`))
  }

  // 3. Verify HMAC-signed state. P1-01: prior implementation accepted any
  // base64-encoded JSON, which let attackers forge a state for a victim's
  // tenant_id and capture the OAuth flow.
  if (!state) {
    return NextResponse.redirect(new URL(`${redirectUrl}?stripe=invalid_state`))
  }
  const verified = verifyOAuthState(state)
  if (!verified) {
    return NextResponse.redirect(new URL(`${redirectUrl}?stripe=invalid_state`))
  }
  const tenantId = verified.tenantId

  // 4. Exchange code for Stripe account
  let stripeAccountId: string
  try {
    const tokenResponse = await stripe.oauth.token({
      grant_type: 'authorization_code',
      code,
    })
    const stripeUserId = tokenResponse.stripe_user_id
    if (!stripeUserId) {
      console.error('[Stripe OAuth] No stripe_user_id in token response')
      return NextResponse.redirect(new URL(`${redirectUrl}?stripe=exchange_failed`))
    }
    stripeAccountId = stripeUserId
  } catch (err) {
    console.error('[Stripe OAuth] Token exchange failed:', err)
    return NextResponse.redirect(new URL(`${redirectUrl}?stripe=exchange_failed`))
  }

  // 5. Upsert Stripe connection using the service client. The user's cookie
  // session is irrelevant here — we already validated the tenantId via
  // signed state.
  const supabase = await createServiceClient()
  const { error: upsertError } = await supabase
    .from('stripe_connections')
    .upsert({
      tenant_id: tenantId,
      stripe_account_id: stripeAccountId,
      scope: 'read_write',
      connected_at: new Date().toISOString(),
      disconnected_at: null,
      is_active: true,
    }, { onConflict: 'tenant_id' })

  if (upsertError) {
    console.error('[Stripe OAuth] DB upsert failed:', upsertError)
    return NextResponse.redirect(new URL(`${redirectUrl}?stripe=db_error`))
  }

  // Event #6 (LIF-06, OAuth-callback half): the tenant just connected Stripe
  // Connect — mirror the connect:active signal into the CRM. Enqueue-only +
  // fail-open; the redirect below is never blocked. The `account.updated`
  // webhook (plan 52-03) covers later enable/disable transitions.
  await enqueueXphereSync(tenantId, 'connect_changed')

  // 6. Success — redirect to settings
  return NextResponse.redirect(new URL(`${redirectUrl}?stripe=connected`))
}
