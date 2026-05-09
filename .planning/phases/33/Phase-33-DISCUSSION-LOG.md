---
phase: 33
plan: 33
started: 2026-05-09T17:00:00Z
status: discussed
next_action: plan-phase 33
---

# Phase 33 Discussion Log

## Date: 2026-05-09

## Context Discovery

**Milestone:** v2.0 Monetization (SEED-009) — Phase 33 of 5 phases
**Previous phases completed:** 30 (Schema), 31 (Superadmin Plan UI), 32 (Stripe Connect OAuth)
**Current state:** Phase 33 directory created, context documented. Ready to plan.

### What Phase 33 Covers

From ROADMAP.md: "Stripe payment processing, webhook handlers, idempotency"

From SEED-009 requirements:
- MON-03: Stripe Connect integration for tenant payments
- MON-05: Webhook handlers with idempotency

### Available Infrastructure

- ✅ Stripe SDK initialized (`src/lib/stripe.ts`)
- ✅ Feature gates (`isStripeEnabled`, `getStripeConnection`)
- ✅ `getTenantPlan()` returns `EffectivePlan` with `transaction_fee_pct`
- ✅ `stripe_connections` table with `is_active` flag
- ✅ `processed_stripe_events` table with PRIMARY KEY on `stripe_event_id`
- ✅ 3 seeded plans with features arrays (payments plan includes `stripe-connect`)
- ✅ OAuth routes for connect/disconnect/callback

### Missing Infrastructure

- ❌ No payment-intent creation route
- ❌ No webhook handler
- ❌ No frontend checkout integration
- ❌ No `@stripe/stripe-js` or `@stripe/react-stripe-js` packages
- ❌ `STRIPE_WEBHOOK_SECRET` env var not provisioned
- ❌ `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` env var not provisioned

## Key Architectural Decisions Discussed

### 1. PaymentIntent Flow: Server-Create, Client-Confirm

**Decision:** PaymentIntent is created server-side (`POST /api/stripe/payment-intents`) and only `client_secret` is returned to client. Client uses Stripe.js to confirm the payment.

**Rationale:**
- Secret key never leaves server
- Better UX than server-side redirect flows
- Stripe Elements handles 3DS, card validation, etc.
- Standard pattern for modern Stripe integrations

**Implementation:**
- `POST /api/stripe/payment-intents` with `{ order_id }` body
- Server creates PaymentIntent on tenant's connected Stripe account via `transfer_data`
- Returns `{ client_secret: string }`
- Client: `stripe.confirmPayment({ clientSecret, return_url })`

### 2. Stripe Connect Routing

**Decision:** Payment routes to tenant's connected Stripe account using `transfer_data`, with platform fee extracted via `application_fee_amount`.

**Calculation:**
```typescript
const fee_pct = effectivePlan.transaction_fee_pct  // e.g. 0.0050 (0.50%)
const application_fee_amount = Math.floor(order_total * fee_pct)
// Transfer to tenant: full amount - fee
```

**Rationale:** Platform takes 0.50% transaction fee on payments plan. Tenant receives net after fee. This is consistent with migration 029's `transaction_fee_pct` column.

### 3. Webhook: Raw Body + Idempotency in Same Transaction

**Decision:** Webhook handler uses `await request.text()` (not `request.json()`), verifies signature, and wraps idempotency record + business logic in same DB transaction.

**Critical code pattern:**
```typescript
const body = await request.text()
const event = stripe.webhooks.constructEvent(body, sig, secret)
// Same transaction:
await tx.from('processed_stripe_events').upsert({ stripe_event_id: event.id, processed_at: now() })
await tx.from('orders').update({ status: 'paid' }).eq('payment_intent_id', event.data.object.id)
```

**Why same transaction:** If business work succeeds but idempotency record fails to write, crash causes double-fulfill on Stripe retry. Transaction prevents this.

### 4. Webhook Returns 200 Immediately

**Decision:** `return NextResponse.json({ received: true })` fires immediately; heavy processing runs async.

**Rationale:** Stripe webhook timeout is 30 seconds. Slow DB writes or external API calls risk timeout → Stripe retries → potential duplicate processing even with idempotency. Returning 200 fast + processing async avoids this.

**Caveat:** Async errors must be logged explicitly (Sentry, console.error) — Stripe won't retry 200 responses.

### 5. Edge Runtime Compatibility

**Decision:** All routes use Edge Runtime-compatible patterns (no `crypto.getRandomValues`, no Buffer, no Node.js-only modules).

**Implication:**
- `Buffer` not available in Edge — use `btoa()` for base64 encoding of OAuth state (already in Phase 32 code)
- Stripe SDK is Node.js only — use dynamic import inside route handlers (already pattern in `stripe.ts`)
- `request.text()` works in both Edge and Node.js runtimes

### 6. Checkout Page Architecture

**Decision:** Stripe.js loaded on checkout page only via dynamic import. Checkout page is `'use client'` component wrapping Stripe Elements.

**Rationale:**
- Loading Stripe.js on all public pages adds ~70KB to every menu page load
- Checkout is already a full-page interaction — no CDN edge optimization needed
- Dynamic import keeps marketing/menu pages fast

## Open Questions (blocked for planning)

### Q1: Where does the checkout page live?

**Options:**
- `src/app/(public)/checkout/page.tsx` — standalone checkout
- Integrated into existing `/[slug]` menu page as a checkout modal/tab
- `src/app/(public)/[slug]/checkout/page.tsx` — checkout tied to tenant menu

**Recommendation for planning:** Standalone `/checkout/[orderId]` — cleaner separation, easier to test, follows standard e-commerce patterns.

### Q2: Does payment replace or augment existing order flow?

Current order flow: customer fills cart → POST `/api/orders` → creates `pending` order → (no payment step)

**Options:**
- **Replace:** Order only created after successful payment (no pending state)
- **Augment:** Order created as `pending` → customer pays → webhook updates to `paid`
- **Hybrid:** Order created on cart submit → payment happens in checkout → webhook confirms

**Recommendation for planning:** Augment flow — order created on cart submit, payment step follows. This allows:
- KDS to see orders before payment (useful for walk-in customers)
- Cleaner UX (customer sees order immediately after cart submit)
- Webhook is the source of truth for payment confirmation

### Q3: Payment failure UX

On card decline, what happens?

**Options:**
- Order stays `pending` → customer retries from checkout page
- Order cancelled → customer starts over
- Order marked `payment_failed` → customer retries from checkout page

**Recommendation for planning:** Order stays `pending`, checkout page shows error message, customer can retry or abandon. Stripe Elements handles retry flow natively.

### Q4: Environment variables

`STRIPE_WEBHOOK_SECRET` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` are not in `.env.local`. Need to be provisioned before Phase 33 execution.

**Action:** These need to be added to `.env.local` before Phase 33 executes. The webhook route will fail without `STRIPE_WEBHOOK_SECRET`. The checkout page will fail without `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`.

### Q5: Stale pending orders

Orders left in `pending` status for hours/days without payment. Who cleans them up?

**Recommendation for planning:** Defer to Phase 34+ — not a Phase 33 blocker. Log a note that stale order cleanup is a follow-up concern.

## Decisions Made (locked for planning)

1. **PaymentIntent server-create pattern** — secret key never exposed to client
2. **Stripe Connect routing** — `transfer_data.destination` = tenant's `stripe_account_id`, `application_fee_amount` = `floor(order_total * transaction_fee_pct)`
3. **Raw body for webhooks** — `request.text()` not `request.json()` for signature verification
4. **Idempotency in same transaction** — upsert `processed_stripe_events` + business work together
5. **200 immediately for webhooks** — async processing, explicit error logging
6. **Checkout page standalone** — dynamic Stripe.js import, client-side confirmation
7. **Order augment pattern** — order created on cart submit, payment webhook confirms
8. **Edge Runtime safe** — no Node-only APIs in route handlers

## Dependencies for Execution

| Dependency | Status | Notes |
|---|---|---|
| `@stripe/stripe-js` | ❌ Not installed | Install before Phase 33 |
| `@stripe/react-stripe-js` | ❌ Not installed | Install before Phase 33 |
| `STRIPE_WEBHOOK_SECRET` env | ❌ Missing | Add to `.env.local` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` env | ❌ Missing | Add to `.env.local` |
| `processed_stripe_events` table | ✅ Exists | Migration 029 already |
| `stripe_connections` table | ✅ Exists | Migration 029 already |
| `getTenantPlan()` helper | ✅ Exists | `src/lib/tenant-plan.ts` |

## Next Step

Run `plan-phase 33` to create the plan file with task breakdown.

## Notes

- The `stripe_event_id` column in `processed_stripe_events` is TEXT (not UUID) — Stripe event IDs are strings like `evt_xxx`
- Phase 33 is purely payment processing — subscription billing (MON-01, MON-02) is Phase 34
- Phase 33 does NOT need to handle subscription lifecycle events (`invoice.paid`, `customer.subscription.updated`) — those are for Phase 34