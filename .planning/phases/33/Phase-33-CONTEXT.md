---
phase: 33
plan: 33
subsystem: stripe
tags: [stripe, payments, webhooks, monetização]
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
    - Edge Runtime safe — no Node.js-only APIs
key_files:
  created:
    - src/app/api/stripe/webhooks/route.ts (webhook handler)
    - src/app/api/stripe/payment-intents/route.ts (create intent)
    - src/lib/stripe.ts (payment intent helpers added)
    - src/app/(public)/checkout/page.tsx (Stripe Elements integration)
  modified:
    - src/lib/stripe.ts (isStripeEnabled → getOrCreatePaymentIntent)
    - src/types/database.ts (PaymentIntent related types)
decisions:
  - "PaymentIntent created server-side only — secret key never exposed to client"
  - "Raw body (await request.text()) for webhook signature — not request.json()"
  - "Idempotency record + business work in same DB transaction — prevents double-fulfill on crash"
  - "Stripe Connect transfer_data.application_fee_amount = floor(order_total * plan.transaction_fee_pct)"
  - "Webhook returns 200 immediately, processes async — Stripe 30s timeout"
  - "Stripe.js loaded only on checkout page (dynamic import) — avoids CDN edge issues"
---

# Phase 33 Context: Payment Intent + Webhook

## Objective

Implement Stripe payment processing for xmartmenu's v2.0 monetization:
- Server-side PaymentIntent creation with Stripe Connect routing
- Webhook handler with signature verification and idempotency
- Frontend Stripe Elements integration (checkout page)

## Prior Art (Phases 30–32)

### What's Already Built

| Component | Location | Status |
|---|---|---|
| Stripe SDK init | `src/lib/stripe.ts` | ✅ API version `2026-04-22.dahlia` |
| Feature gate helpers | `src/lib/stripe.ts` (`isStripeEnabled`, `getStripeConnection`) | ✅ |
| getTenantPlan | `src/lib/tenant-plan.ts` | ✅ returns `EffectivePlan` with `transaction_fee_pct` |
| OAuth initiation | `src/app/api/stripe/connect/oauth/route.ts` | ✅ |
| OAuth callback | `src/app/api/stripe/connect/callback/route.ts` | ✅ |
| Disconnect | `src/app/api/stripe/connect/disconnect/route.ts` | ✅ |
| stripe_connections table | Migration 029 | ✅ is_active=true for connected tenants |
| processed_stripe_events table | Migration 029 | ✅ PRIMARY KEY on stripe_event_id |
| Plans seed | Migration 029 | ✅ 3 plans with features arrays |

### Plan Features

```
menu plan:       ["digital-menu","qr-code","analytics"]
orders plan:     ["digital-menu","orders","qr-code","analytics"]
payments plan:   ["digital-menu","orders","payments","stripe-connect","analytics"]
```

Only `payments` plan includes `payments` and `stripe-connect` features. Transaction fee on payments plan: `0.0050` (0.50%).

### Superadmin Subscription Management

`src/app/api/superadmin/tenants/[id]/subscription/route.ts` — CRUD subscription overrides (billing cycle, prices, transaction fee override). Used by superadmin to manage tenant plans. Phase 34 (Tenant Subscription UI) builds on this.

### Order API

`src/app/api/orders/route.ts` — Creates orders with items, notes, ingredient_modifications. No payment integration yet — just creates pending orders. Phase 33 will wire this to Stripe.

### Migration 029 Schema (relevant excerpt)

```sql
-- processed_stripe_events: webhook idempotency
CREATE TABLE processed_stripe_events (
  stripe_event_id TEXT PRIMARY KEY,
  processed_at    TIMESTAMPTZ DEFAULT now()
);

-- RLS: service_role only (not authenticated — webhook endpoint uses service key)
ALTER TABLE processed_stripe_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Processed events accessible to service role"
  ON processed_stripe_events FOR ALL TO service_role USING (true) WITH CHECK (true);
```

RLS on processed_stripe_events uses `service_role` — webhook endpoint must use `createServiceClient()`, not regular user auth.

## What Phase 33 Needs to Build

### 1. PaymentIntent Creation Route

**Path:** `src/app/api/stripe/payment-intents/route.ts`

**Purpose:** Server-side endpoint to create a Stripe PaymentIntent, routed to the tenant's connected Stripe account.

**Flow:**
1. Authenticate user → get tenant context
2. Gate: tenant plan must include `payments` feature
3. Gate: tenant must have active `stripe_connections` record
4. Gate: order must belong to this tenant (prevent cross-tenant payment)
5. Fetch stripe_account_id from `stripe_connections` table
6. Fetch transaction_fee_pct from `getTenantPlan()` → EffectivePlan
7. Calculate `application_fee_amount = floor(order_total * transaction_fee_pct)`
8. Create Stripe PaymentIntent on tenant's connected account (transfer_data)
9. Return `{ client_secret }` — never expose payment intent ID to client

**Request body:**
```typescript
{
  order_id: string       // order must already exist with status='pending'
  return_url?: string    // for redirect after payment
}
```

**Response:**
```typescript
{
  client_secret: string  // stripe.confirmPayment client secret
}
```

**Key decision:** PaymentIntent uses `confirmation_method: 'manual'` — frontend Stripe Elements handles confirmation client-side. This avoids server-side confirmation complexity and gives better UX.

**Key decision:** `transfer_data.destination` = tenant's stripe_account_id, `transfer_data.amount` = full order amount, `application_fee_amount` = platform fee. Tenant receives `full_amount - fee`.

**Key decision:** Order total must be in BRL (Brazilian Real), smallest unit = cents (multiply by 100). Stripe uses lowest currency unit.

### 2. Webhook Handler

**Path:** `src/app/api/stripe/webhooks/route.ts`

**Purpose:** Receives Stripe events, verifies signature, processes idempotently.

**Critical implementation rules:**
- `const body = await request.text()` — NEVER `request.json()` — raw body required for signature
- `stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!)` — throws on bad signature
- Idempotency: upsert into `processed_stripe_events` + business work in SAME transaction
- Return 200 immediately — async processing for slow operations
- Return 200 on handler error (log it) — only return 400 on signature failure

**Events to handle:**

| Event | Action |
|---|---|
| `payment_intent.succeeded` | Update order status to `paid` or trigger fulfillment |
| `payment_intent.payment_failed` | Log failure, optionally notify tenant |
| `account.updated` | Sync Stripe account status to stripe_connections table |
| `*` | Log unknown event type (no crash) |

**Important:** For Stripe Connect, `payment_intent.succeeded` arrives on the connected account's webhook. If using separate webhook endpoints per account vs. one global endpoint — confirm xmartmenu's webhook configuration.

**Key decision:** Single webhook endpoint handles all Stripe events. `account.updated` tracks connection status changes (Payouts enabled, restrictions, etc.).

### 3. Frontend: Checkout Flow

**Path:** TBD (likely `src/app/(public)/checkout/page.tsx` or integrated into existing order flow)

**Purpose:** Replace or augment existing WhatsApp/direct order submission with Stripe payment.

**Flow:**
1. Customer adds items to cart → proceeds to checkout
2. Checkout page renders Stripe Payment Element
3. On form submit → POST `/api/stripe/payment-intents` with order_id
4. Get `{ client_secret }` → confirm payment with Stripe.js
5. On success → redirect to confirmation page
6. Webhook fires → order status updated

**Key decision:** Stripe.js loaded via dynamic import on checkout page only — keeps CDN edge cache clean for other public pages.

**Key decision:** If payment fails or customer abandons, order stays `pending`. A background job (or manual) cleans up stale pending orders > X hours.

### 4. Stripe.js Dependencies

Need to install on frontend:
```
npm install @stripe/stripe-js @stripe/react-stripe-js
```

**Key decision:** `@stripe/react-stripe-js` requires `'use client'` directive — checkout page must be client component or wrap in a client `<CheckoutWrapper>`.

## Implementation Order (recommended)

1. **Install dependencies** — `@stripe/stripe-js @stripe/react-stripe-js`
2. **Webhook route** — simplest, no frontend dependency, can be tested with Stripe CLI locally
3. **Payment intent route** — depends on webhook infra existing
4. **Frontend checkout integration** — depends on both routes

## Open Questions / Decisions Needed

1. **Checkout URL path:** `/checkout/[orderId]` or integrated into existing public menu `/[slug]` order flow? Existing order API at `/api/orders` creates pending orders — should payment integrate there or as a separate checkout step?

2. **Return URL for Stripe redirect:** Where does customer go after payment? `/checkout/[orderId]/confirmation` ?

3. **Payment failure handling:** On card decline, does customer retry or abandon? What's the UX?

4. **Stripe.js environment:** Is `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` already in `.env.local`? Need both publishable and secret keys.

5. **Webhook secret management:** `STRIPE_WEBHOOK_SECRET` — does it exist in `.env.local`? For local dev, Stripe CLI provides a test secret via `stripe listen --forward-to localhost:3000/api/stripe/webhooks`.

6. **Stale pending orders:** Who cleans up orders left in `pending` status after X hours? This is a follow-up concern for Phase 34+ but worth noting.

## Environment Variables Needed

```
STRIPE_WEBHOOK_SECRET=whsec_...        # webhook signature verification
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...  # client-side Stripe.js
STRIPE_SECRET_KEY=sk_test_...          # server-side only
STRIPE_CLIENT_ID=ca_...               # already exists from Phase 32
```

These are missing from the codebase — need to be provisioned.

## References

- Stripe PaymentIntents API: https://docs.stripe.com/api/payment_intents/create
- Stripe Webhook verification: https://docs.stripe.com/webhooks/signature?lang=node
- Next.js + Stripe App Router: https://stripe.com/docs/payments/quickstart
- Stripe Connect onplatform payments: https://stripe.com/docs/connect/collect-payment
- Processed stripe events table already in migration 029 (lines 76-84)