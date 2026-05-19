---
id: SEED-017
status: completed
planted: 2026-05-19
planted_during: v2.2-milestone-execution
completed: 2026-05-19
completed_in: phase-44-tip-system
trigger_when: working on checkout flow, payment features, or expanding the payments-plan tier
scope: small
---

# SEED-017: Tip System at Checkout

## Why This Matters

Tipping is a natural revenue-share opportunity for both the restaurant and the platform. Today the checkout flow has no tip mechanism — the customer pays only the order total. A tip system adds a one-tap upsell moment at the highest-intent point in the flow (the moment the customer is already paying).

The design is intentionally simple: 4 buttons at checkout (15%, 18%, 20%, Custom), all configurable by the restaurant. The feature is opt-in (off by default), gated to the payments plan, and the tip amount flows through the same Stripe Connect PaymentIntent already handling orders — no new payment infrastructure needed.

**Business rules:**
- Feature is disabled by default — restaurant explicitly enables it in settings
- Only available on the `payments` plan (SEED-009) — the plan that has Stripe Connect active
- Default tip percentages: 15%, 18%, 20% — restaurant can change any of these
- Custom option always present when tips are enabled — customer enters any amount
- Tip is calculated on the order subtotal (before delivery fee)
- Tip stored on the order record and surfaced in KDS + orders view

## When to Surface

**Trigger:** when working on the checkout flow, Stripe payment processing, or expanding payments-plan value

Surface during `/gsd:new-milestone` when the scope involves:
- Checkout UX improvements
- Payment plan feature expansion (adding value to justify payments-tier pricing)
- Tipping culture rollout (US market, food delivery)
- Revenue-share mechanics between platform and restaurant

## Scope Estimate

**Small** — 1–2 days. Components:

1. **DB migration**
   - `tenant_settings`: add `tips_enabled BOOLEAN DEFAULT false`, `tip_percentage_1 INT DEFAULT 15`, `tip_percentage_2 INT DEFAULT 18`, `tip_percentage_3 INT DEFAULT 20`
   - `orders`: add `tip_cents INT NOT NULL DEFAULT 0`

2. **Admin UI — Settings**
   - New "Tips" section in `/admin/settings/store` (gated: only shown when tenant is on `payments` plan)
   - Enable/disable toggle (default off)
   - Three numeric inputs for the preset percentages (integer, 1–100)
   - Shown only when tips are enabled

3. **Customer UX — checkout tip selector**
   - Rendered at checkout only when `tips_enabled = true` AND tenant is on payments plan
   - 4 buttons: `{tip_percentage_1}%`, `{tip_percentage_2}%`, `{tip_percentage_3}%`, `Custom`
   - No tip selected by default (opt-in per transaction, not pre-selected)
   - Custom: opens a numeric input for a free-form dollar amount
   - Tip amount displayed in cart summary above the total
   - Final total = subtotal + delivery_fee + tip

4. **Payment processing**
   - Tip amount added to the Stripe PaymentIntent `amount` field — same Connect flow as today
   - `tip_cents` stored on the order record alongside `total_cents`
   - `application_fee_amount` calculated on `items_total` only (not on tip) — tip goes 100% to restaurant

5. **KDS + Orders view**
   - Tip amount shown on KDS order cards when non-zero
   - Orders view shows tip column
   - Order total in admin view = subtotal + delivery + tip

## Breadcrumbs

- `src/app/(public)/[slug]/` — `CartModal.tsx` — where the tip selector lives at checkout
- `src/app/api/public/orders/route.ts` — order insert; needs `tip_cents` + updated `total_cents`
- `src/app/(admin)/settings/store/StoreClient.tsx` — where the Tips settings section goes (plan-gated)
- `src/lib/tenant-plan.ts` — `getTenantPlan()` helper used to gate the feature
- `src/app/(admin)/kds/` — KDS order cards, tip display
- `src/app/(admin)/orders/` — orders list/modal, tip column
- `src/types/database.ts` — `TenantSettings` + `Order` receive new fields
- `supabase/migrations/` — next migration after current (035+)
- Stripe PaymentIntent creation — `src/app/api/stripe/payment-intent/route.ts` or equivalent

## Notes

- **Plan gating is load-bearing** — tips require Stripe Connect to be active, which is payments-plan only. The admin settings section should not render for menu/orders-plan tenants, and the checkout tip UI should not render even if somehow `tips_enabled` is true on a non-payments tenant.
- **No pre-selection** — do not pre-select a tip percentage by default. The customer must actively choose. Pre-selecting a tip is a dark pattern that erodes trust.
- **Application fee stays on order subtotal** — the platform's fee percentage (from `tenant_subscriptions.transaction_fee_pct`) applies to `items_total` only. The full tip goes to the restaurant. This is the industry-standard arrangement and avoids charging a fee on a gratuity.
- **tip_cents on orders is always stored** — even when tips are disabled (value = 0). This avoids nullable handling.
- **SEED-013 (order types)** — when delivery is active, tip is calculated on subtotal only, delivery fee excluded. Coordinate the total calculation: `total_cents = items_total + delivery_fee_cents + tip_cents`.
