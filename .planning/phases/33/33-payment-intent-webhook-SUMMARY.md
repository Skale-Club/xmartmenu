---
phase: 33
plan: "01"
name: Payment Intent + Webhook
subsystem: stripe
tags: [stripe, payments, webhooks, monetization]
dependency_graph:
  requires:
    - Phase 30 (Schema + Planos Base — plans/subscriptions tables, getTenantPlan)
    - Phase 32 (Stripe Connect OAuth — oauth/callback/disconnect routes, stripe.ts)
  provides:
    - MON-03 (payment processing via Stripe Connect)
    - MON-05 (webhook handlers with idempotency)
  affects:
    - src/lib/stripe.ts (add payment-intent helpers)
    - src/app/api/stripe/ (new webhook route)
    - src/app/(public)/checkout flow (Stripe Elements integration)
tech_stack:
  added:
    - @stripe/stripe-js (client-side Stripe.js)
    - @stripe/react-stripe-js (React components)
  patterns:
    - PaymentIntent server creation → client_secret returned to frontend
    - Stripe Connect application_fee + transfer_data for platform fee
    - Raw body (request.text()) for webhook signature verification
    - Idempotency via processed_stripe_events upsert (same transaction as business logic)
key_files:
  created:
    - src/app/api/stripe/webhooks/route.ts (webhook handler)
    - src/app/api/stripe/payment-intents/route.ts (create intent)
    - src/components/StripeProvider.tsx (Stripe Elements wrapper)
    - src/app/(public)/checkout/[orderId]/page.tsx (checkout page)
    - src/app/(public)/checkout/[orderId]/CheckoutForm.tsx (payment form)
    - src/app/(public)/checkout/[orderId]/confirmation/page.tsx (confirmation)
  modified:
    - src/lib/stripe.ts (add createPaymentIntent, getOrCreatePaymentIntent)
    - package.json (add @stripe/stripe-js, @stripe/react-stripe-js)
decisions:
  - PaymentIntent routes to Stripe Connect with application_fee_amount = floor(order_total * transaction_fee_pct)
  - Webhook uses raw body (request.text()) for signature verification
  - Idempotency upsert + business logic in same DB transaction to prevent double-fulfill
  - Webhook returns 200 immediately — Stripe won't retry 200s
---

# Phase 33 Plan 01: Payment Intent + Webhook Summary

## One-Liner

Stripe payment processing with PaymentIntent creation, webhook handling with idempotency, and checkout UI with Stripe Elements.

## Objective

Implement Stripe payment processing for xmartmenu's v2.0 monetization:
- Server-side PaymentIntent creation with Stripe Connect routing
- Webhook handler with signature verification and idempotency
- Frontend Stripe Elements checkout page

## Tasks Completed

| Task | Name | Status |
|------|------|--------|
| 1 | Install Stripe frontend packages | ✅ Complete |
| 2 | Add createPaymentIntent helper to stripe.ts | ✅ Complete |
| 3 | Create PaymentIntent API route | ✅ Complete |
| 4 | Create Webhook handler with idempotency | ✅ Complete |
| 5 | Create StripeProvider wrapper component | ✅ Complete |
| 6 | Create checkout page with Payment Element | ✅ Complete |
| 7 | Create checkout confirmation page | ✅ Complete |
| 8 | Integration verification | ⏸️ Checkpoint |

## Implementation Details

### PaymentIntent Flow
1. Client navigates to `/checkout/[orderId]` with pending order
2. Server fetches order, validates status, checks Stripe enabled
3. Server calls `createPaymentIntent()` with order total in BRL cents
4. PaymentIntent created on tenant's Stripe Connect account with application_fee_amount
5. client_secret returned to client
6. Client renders StripeProvider with Payment Element
7. On submit, stripe.confirmPayment() redirects to confirmation

### Webhook Handler
1. Receives raw body + stripe-signature header
2. Verifies signature using STRIPE_WEBHOOK_SECRET
3. Checks processed_stripe_events for idempotency
4. Processes payment_intent.succeeded → updates order status to 'paid'
5. Processes payment_intent.payment_failed → updates order status to 'payment_failed'
6. Records event in processed_stripe_events (same transaction)

## Environment Variables Required

```bash
# Already in Phase 32
STRIPE_SECRET_KEY=sk_test_...
STRIPE_CLIENT_ID=ca_...

# Added in Phase 33 (needed for webhook verification)
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

## Files Created/Modified

| File | Lines | Action |
|------|-------|--------|
| package.json | +2 | Added @stripe/stripe-js, @stripe/react-stripe-js |
| src/lib/stripe.ts | +101 | Added createPaymentIntent, getOrCreatePaymentIntent |
| src/app/api/stripe/payment-intents/route.ts | 75 | Created |
| src/app/api/stripe/webhooks/route.ts | 125 | Created |
| src/components/StripeProvider.tsx | 45 | Created |
| src/app/(public)/checkout/[orderId]/page.tsx | 203 | Created |
| src/app/(public)/checkout/[orderId]/CheckoutForm.tsx | 57 | Created |
| src/app/(public)/checkout/[orderId]/confirmation/page.tsx | 147 | Created |

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None - all functionality wired to data sources.

## Self-Check

- [x] TypeScript compilation passes (verified via `npx tsc --noEmit`)
- [x] Stripe packages installed (@stripe/stripe-js@9.4.0, @stripe/react-stripe-js@6.3.0)
- [x] All 7 implementation tasks committed in b60427b
- [x] Files exist as documented
- [x] Task 8 pending checkpoint documented with verification steps
- [x] Duration recorded: ~15 minutes

## Metrics