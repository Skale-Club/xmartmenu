---
phase: "33"
plan: "01"
name: Payment Intent + Webhook
type: execute
autonomous: false
wave: 1
depends_on: []
requirements:
  - MON-03
  - MON-05
---

# Phase 33 Plan 01: Payment Intent + Webhook

## Objective

Implement Stripe payment processing for xmartmenu's v2.0 monetization:
- Server-side PaymentIntent creation with Stripe Connect routing
- Webhook handler with signature verification and idempotency
- Frontend Stripe Elements checkout page

## Context

Phase 30 established the database schema (`plans`, `tenant_subscriptions`, `stripe_connections`, `processed_stripe_events` tables) and `getTenantPlan()` helper. Phase 31 added superadmin plan management UI. Phase 32 added Stripe Connect OAuth flow. This plan completes the payment processing loop with PaymentIntent creation, webhook handling, and checkout UI.

**Prerequisites:**
- `stripe` package installed (Phase 32)
- `getTenantPlan()` returns `EffectivePlan` with `transaction_fee_pct` (Phase 30)
- `stripe_connections` table with active connections (Phase 32)
- `processed_stripe_events` table for idempotency (Migration 029)

**Feature gating:**
- PaymentIntent creation requires tenant on `payments` plan with active Stripe connection
- Checkout page only renders for tenants with Stripe Connect enabled

## Implementation

### Task 1: Install Stripe frontend packages

**Type:** `auto`

Install the official Stripe JavaScript SDK and React components.

**Behavior:**
- Run `npm install @stripe/stripe-js @stripe/react-stripe-js` in project root
- Packages enable client-side Stripe.js and React wrapper components

**Verification:**
- `npm list @stripe/stripe-js @stripe/react-stripe-js` shows installed packages
- No TypeScript errors on import

---

### Task 2: Add PaymentIntent helpers to stripe.ts

**Type:** `auto`

Extend the Stripe library with PaymentIntent creation and helper functions.

**Files to modify:**
- `src/lib/stripe.ts`

**Behavior:**
```typescript
// Add to src/lib/stripe.ts:

// Create PaymentIntent for an order
export async function createPaymentIntent(params: {
  tenantId: string
  orderId: string
  amount: number // in cents (smallest currency unit)
  currency?: string
}): Promise<{ clientSecret: string; paymentIntentId: string }> {
  const supabase = await import('@/lib/supabase/server').then(m => m.createClient())
  const { getTenantPlan } = await import('@/lib/tenant-plan')

  // 1. Get tenant's Stripe connection
  const { data: connection } = await supabase
    .from('stripe_connections')
    .select('stripe_account_id')
    .eq('tenant_id', params.tenantId)
    .eq('is_active', true)
    .single()

  if (!connection) {
    throw new Error('No active Stripe connection for tenant')
  }

  // 2. Get transaction fee from plan
  const plan = await getTenantPlan(params.tenantId)
  if (!plan || !plan.features.includes('payments')) {
    throw new Error('Payments not available on current plan')
  }

  const feePct = plan.transaction_fee_pct || 0.005
  const applicationFeeAmount = Math.floor(params.amount * feePct)

  // 3. Create PaymentIntent on tenant's connected account
  const paymentIntent = await stripe.paymentIntents.create({
    amount: params.amount,
    currency: params.currency || 'brl',
    application_fee_amount: applicationFeeAmount,
    transfer_data: {
      destination: connection.stripe_account_id,
    },
    metadata: {
      order_id: params.orderId,
      tenant_id: params.tenantId,
    },
  })

  return {
    clientSecret: paymentIntent.client_secret!,
    paymentIntentId: paymentIntent.id,
  }
}
```

**Verification:**
- File compiles without TypeScript errors
- `createPaymentIntent` function exported and callable

---

### Task 3: PaymentIntent creation API route

**Type:** `auto`

Create the endpoint for creating PaymentIntents from the checkout flow.

**Files to create:**
- `src/app/api/stripe/payment-intents/route.ts`

**Behavior:**
```
POST /api/stripe/payment-intents
Authorization: session
Content-Type: application/json

{ order_id: string }
```

1. Authenticate user via session, get tenant context
2. Fetch order from DB, verify it belongs to tenant
3. Check order status is `pending` (not already paid)
4. Check tenant plan includes `payments` feature
5. Check tenant has active Stripe connection
6. Calculate `application_fee_amount = floor(order_total * transaction_fee_pct)`
7. Call `stripe.createPaymentIntent()` with `transfer_data`
8. Update order with `payment_intent_id`
9. Return `{ client_secret }`

**Request body:**
```typescript
{
  order_id: string       // order must exist with status='pending'
}
```

**Response:**
```typescript
{
  client_secret: string  // stripe.confirmPayment client secret
}
```

**Error handling:**
- 401 → unauthorized
- 403 → plan doesn't include payments or no Stripe connection
- 404 → order not found
- 400 → order not in pending status or order belongs to different tenant

**Verification:**
- POST with valid order_id returns `{ client_secret }`
- POST with non-existent order returns 404
- POST with paid order returns 400
- POST for tenant without Stripe connection returns 403

---

### Task 4: Webhook handler route

**Type:** `auto`

Create the webhook endpoint for Stripe events with signature verification and idempotency.

**Files to create:**
- `src/app/api/stripe/webhooks/route.ts`

**Behavior:**
```
POST /api/stripe/webhooks
Stripe-Signature: sig header
Raw body (not JSON)
```

1. Extract raw body: `const body = await request.text()`
2. Get signature header: `request.headers.get('stripe-signature')`
3. Verify signature: `stripe.webhooks.constructEvent(body, sig, secret)`
4. **Idempotency guard:** Check `processed_stripe_events` for event ID
   - If exists → return 200 (already processed)
   - If not → proceed
5. Process event based on type:
   - `payment_intent.succeeded` → update order status to `paid`, set `payment_intent_id`
   - `payment_intent.payment_failed` → update order to `payment_failed`
   - `account.updated` → sync Stripe account status to `stripe_connections`
   - `*` → log unknown event
6. **Same transaction:** Upsert idempotency record + business logic together
7. Return 200 immediately (async processing for slow ops)

**Critical implementation details:**
- Must use `await request.text()` — NOT `request.json()` — raw body required for signature verification
- Webhook must use service_role client (`createClient()` from server lib) — not user session
- Idempotency upsert + business work in same DB transaction to prevent double-fulfill on crash

**Error handling:**
- Signature verification fails → return 400
- All other errors → return 200 (Stripe won't retry 200s, log errors manually)

**Verification:**
- Valid webhook with `payment_intent.succeeded` updates order to `paid`
- Duplicate event (same event ID) returns 200 without duplicate processing
- Invalid signature returns 400

---

### Task 5: Stripe provider wrapper

**Type:** `auto`

Create a client-side wrapper for Stripe Elements initialization.

**Files to create:**
- `src/components/StripeProvider.tsx`

**Behavior:**
```tsx
'use client'

import { loadStripe } from '@stripe/stripe-js'
import { Elements } from '@stripe/react-stripe-js'
import { ReactNode, useMemo } from 'react'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)

export function StripeProvider({ children, clientSecret }: { children: ReactNode; clientSecret: string }) {
  const options = useMemo(() => ({
    clientSecret,
    appearance: {
      theme: 'stripe',
      variables: {
        colorPrimary: '#635BFF',
      },
    },
  }), [clientSecret])

  return (
    <Elements stripe={stripePromise} options={options}>
      {children}
    </Elements>
  )
}
```

**Verification:**
- Component compiles without TypeScript errors
- Exports `StripeProvider` component

---

### Task 6: Checkout page with Stripe Elements

**Type:** `auto`

Create the checkout page that renders the Stripe Payment Element.

**Files to create:**
- `src/app/(public)/checkout/[orderId]/page.tsx`

**Behavior:**
1. Server component fetches order details (must belong to tenant)
2. Checks order status is `pending`
3. Calls `/api/stripe/payment-intents` to get client_secret
4. Renders `StripeProvider` wrapper with clientSecret
5. Renders `PaymentElement` form inside wrapper
6. On form submit → `stripe.confirmPayment()` with return_url

**Flow:**
```
/checkout/[orderId]
  ├── Fetch order (must be pending, must belong to tenant's menu)
  ├── POST /api/stripe/payment-intents { order_id }
  ├── Get { client_secret }
  ├── Render StripeProvider(clientSecret)
  │   └── Render PaymentElement form
  ├── On submit → stripe.confirmPayment()
  └── Redirect to return_url with success/failure
```

**Page structure:**
```tsx
// src/app/(public)/checkout/[orderId]/page.tsx
import { createClient } from '@/lib/supabase/server'
import { getTenantPlan } from '@/lib/tenant-plan'
import { isStripeEnabled } from '@/lib/stripe'
import { StripeProvider } from '@/components/StripeProvider'
import { CheckoutForm } from './CheckoutForm'

export default async function CheckoutPage({ params }: { params: { orderId: string } }) {
  const supabase = await createClient()
  
  // Fetch order
  const { data: order } = await supabase
    .from('orders')
    .select('*, order_items(*), tenants(slug)')
    .eq('id', params.orderId)
    .single()

  if (!order || order.status !== 'pending') {
    return <div>Order not found or not pending</div>
  }

  // Get tenant's Stripe status
  const stripeEnabled = await isStripeEnabled(order.tenant_id)
  if (!stripeEnabled) {
    return <div>Stripe payments not available</div>
  }

  // Create PaymentIntent
  const { getOrCreatePaymentIntent } = await import('@/lib/stripe')
  const { clientSecret } = await getOrCreatePaymentIntent({
    tenantId: order.tenant_id,
    orderId: order.id,
    amount: Math.floor(order.total_cents),
  })

  return (
    <StripeProvider clientSecret={clientSecret}>
      <CheckoutForm orderId={order.id} returnUrl={`/checkout/${order.id}/confirmation`} />
    </StripeProvider>
  )
}
```

```tsx
// src/app/(public)/checkout/[orderId]/CheckoutForm.tsx
'use client'

import { useStripe, useElements, PaymentElement } from '@stripe/react-stripe-js'
import { useState } from 'react'

export function CheckoutForm({ orderId, returnUrl }: { orderId: string; returnUrl: string }) {
  const stripe = useStripe()
  const elements = useElements()
  const [error, setError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return

    setProcessing(true)
    setError(null)

    const { error: stripeError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${process.env.NEXT_PUBLIC_BASE_URL}${returnUrl}`,
      },
    })

    if (stripeError) {
      setError(stripeError.message || 'Payment failed')
      setProcessing(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <PaymentElement />
      {error && <div className="text-red-600 text-sm mt-2">{error}</div>}
      <button
        type="submit"
        disabled={!stripe || processing}
        className="mt-4 w-full bg-[#635BFF] text-white py-3 rounded-lg disabled:opacity-50"
      >
        {processing ? 'Processing...' : 'Pay Now'}
      </button>
    </form>
  )
}
```

**Error handling:**
- Order not found or not pending → show error message
- Stripe not enabled for tenant → show message
- PaymentIntent creation fails → show error
- Payment fails → show error, allow retry

**Verification:**
- Navigating to `/checkout/[orderId]` with valid pending order shows payment form
- Submitting valid payment redirects to confirmation
- Invalid order shows appropriate error

---

### Task 7: Checkout confirmation page

**Type:** `auto`

Create the confirmation page after payment completion.

**Files to create:**
- `src/app/(public)/checkout/[orderId]/confirmation/page.tsx`

**Behavior:**
1. Read `payment_intent` and `payment_intent_client_secret` from URL search params
2. Verify payment status via Stripe API or rely on webhook
3. Display success/failure state

```tsx
export default async function ConfirmationPage({
  searchParams,
}: {
  searchParams: { payment_intent?: string; payment_intent_client_secret?: string }
}) {
  const { payment_intent, payment_intent_client_secret } = searchParams

  if (!payment_intent || !payment_intent_client_secret) {
    return <div>Invalid confirmation</div>
  }

  // Could verify with Stripe API, or rely on webhook
  // Display result based on URL params
  return (
    <div className="text-center">
      <h1>Payment Complete!</h1>
      <p>Your order has been confirmed.</p>
    </div>
  )
}
```

**Verification:**
- `/checkout/[orderId]/confirmation` renders confirmation message

---

### Task 8: Integration verification

**Type:** `checkpoint:human-verify`

Verify the complete payment flow works end-to-end.

**Verification steps:**
1. Create an order (via existing cart flow or test order)
2. Navigate to `/checkout/[orderId]`
3. See Stripe Payment Element rendered
4. Enter test card details (use Stripe test card: 4242 4242 4242 4242)
5. Submit payment
6. Redirect to `/checkout/[orderId]/confirmation`
7. Webhook fires → order status updates to `paid`
8. Verify order in DB has status `paid` and `payment_intent_id` set

**Edge cases to test:**
- Payment declined → show error, stay on checkout
- Order already paid → redirect to confirmation
- Tenant without Stripe connection → show error on checkout load

---

## Verification & Success Criteria

1. `npm list @stripe/stripe-js @stripe/react-stripe-js` shows installed packages
2. `src/lib/stripe.ts` exports `createPaymentIntent()` function
3. `POST /api/stripe/payment-intents` creates PaymentIntent and returns client_secret
4. `POST /api/stripe/webhooks` handles `payment_intent.succeeded` events
5. Webhook signature verification works (returns 400 on invalid signature)
6. Idempotency prevents duplicate processing of same event
7. `/checkout/[orderId]` renders Stripe Payment Element
8. Test payment completes and redirects to confirmation
9. Webhook updates order status to `paid`

## Key Files

| File | Action |
|------|--------|
| `package.json` | Modify (add Stripe frontend packages) |
| `src/lib/stripe.ts` | Modify (add createPaymentIntent) |
| `src/app/api/stripe/payment-intents/route.ts` | Create |
| `src/app/api/stripe/webhooks/route.ts` | Create |
| `src/components/StripeProvider.tsx` | Create |
| `src/app/(public)/checkout/[orderId]/page.tsx` | Create |
| `src/app/(public)/checkout/[orderId]/CheckoutForm.tsx` | Create |
| `src/app/(public)/checkout/[orderId]/confirmation/page.tsx` | Create |

## Environment Variables Needed

Add to `.env.local` (if not already present):
```bash
STRIPE_WEBHOOK_SECRET=whsec_...        # webhook signature verification
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...  # client-side Stripe.js
STRIPE_SECRET_KEY=sk_test_...          # server-side only (from Phase 32)
STRIPE_CLIENT_ID=ca_...               # OAuth client ID (from Phase 32)
```

## Dependencies

| Dependency | Status | Notes |
|---|---|---|
| `stripe` (Node.js SDK) | ✅ Installed | From Phase 32 |
| `@stripe/stripe-js` | ❌ Not installed | Install in Task 1 |
| `@stripe/react-stripe-js` | ❌ Not installed | Install in Task 1 |
| `STRIPE_WEBHOOK_SECRET` env | ❌ Missing | Add to `.env.local` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` env | ❌ Missing | Add to `.env.local` |
| `processed_stripe_events` table | ✅ Exists | Migration 029 |
| `stripe_connections` table | ✅ Exists | Migration 029 |
| `getTenantPlan()` helper | ✅ Exists | Phase 30 |

## Notes

- PaymentIntent uses `confirmation_method: 'manual'` — frontend Stripe Elements handles confirmation
- Platform fee: `application_fee_amount = floor(order_total * transaction_fee_pct)`
- Order total in BRL cents (multiply by 100)
- Webhook returns 200 immediately — heavy processing runs async
- Stripe.js loaded via dynamic import in checkout page only — not on all public pages