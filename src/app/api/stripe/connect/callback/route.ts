/**
 * Stripe Connect OAuth callback endpoint
 * 
 * Phase 32: Handles OAuth callback from Stripe
 * GET /api/stripe/connect/callback?code=xxx&state=yyy
 */

import { NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { createClient } from '@/lib/supabase/server'

const STATE_EXPIRY_MS = 15 * 60 * 1000 // 15 minutes

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const state = searchParams.get('state')

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
  const redirectUrl = `${baseUrl}/admin/settings/store`

  // 1. Check for Stripe error (user denied)
  if (error === 'access_denied') {
    return NextResponse.redirect(new URL(`${redirectUrl}?stripe=access_denied`))
  }

  // 2. Validate code present
  if (!code) {
    return NextResponse.redirect(new URL(`${redirectUrl}?stripe=missing_code`))
  }

  // 3. Validate and decode state
  if (!state) {
    return NextResponse.redirect(new URL(`${redirectUrl}?stripe=invalid_state`))
  }

  let stateData: { tenantId: string; timestamp: number }
  try {
    stateData = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'))
  } catch {
    return NextResponse.redirect(new URL(`${redirectUrl}?stripe=invalid_state`))
  }

  // 4. Check state expiry (15 min window)
  if (Date.now() - stateData.timestamp > STATE_EXPIRY_MS) {
    return NextResponse.redirect(new URL(`${redirectUrl}?stripe=invalid_state`))
  }

  const tenantId = stateData.tenantId

  // 5. Exchange code for Stripe account
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

  // 6. Upsert Stripe connection
  const supabase = await createClient()
  const { error: upsertError } = await supabase
    .from('stripe_connections')
    .upsert({
      tenant_id: tenantId,
      stripe_account_id: stripeAccountId,
      scope: 'read_write',
      connected_at: new Date().toISOString(),
      is_active: true,
    }, { onConflict: 'tenant_id' })

  if (upsertError) {
    console.error('[Stripe OAuth] DB upsert failed:', upsertError)
    return NextResponse.redirect(new URL(`${redirectUrl}?stripe=db_error`))
  }

  // 7. Success - redirect to settings
  return NextResponse.redirect(new URL(`${redirectUrl}?stripe=connected`))
}