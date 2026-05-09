---
id: SEED-003
status: completed
completed: 2026-05-09
completed_in: v2.0 (Monetization) — absorbed by SEED-009
superseded_by: SEED-009
planted: 2026-05-05
planted_during: pre-GSD (no .planning/STATE.md yet)
trigger_when: order system (SEED-002) is functional end-to-end
scope: large
depends_on: SEED-002
---

# SEED-003: Stripe Connect payments (tenant-owned accounts)

## Why This Matters

When customers can pay through xmartmenu, money has to land somewhere. Two models:

1. **Platform-held funds** — payments go to xmartmenu's Stripe account, we pay
   tenants out periodically. Requires us to act as a money transmitter, hold
   funds in trust, handle refunds, manage payout schedules, deal with regulatory
   exposure in every jurisdiction.
2. **Stripe Connect (tenant-owned accounts)** — each tenant connects their own
   Stripe account. Payments flow **directly to the tenant**, never touch our
   balance. We take an `application_fee` per charge. Stripe handles payouts,
   refunds, KYC, and tax forms for us.

Option 2 is the right call for a multi-tenant SaaS like xmartmenu: we stay out of
the regulated money flow, tenants get same-day Stripe payouts to accounts they
already trust, and we can charge a clean per-transaction fee without ever
custodying funds.

Connect comes in flavors — **Standard** (tenant has full Stripe dashboard,
maximum tenant control, our least integration work) or **Express** (we host more
of the experience, faster onboarding, slightly more code on our side). Decide
during planning based on tenant sophistication.

## When to Surface

**Trigger:** order system (SEED-002) is functional end-to-end

This seed should be presented during `/gsd:new-milestone` when the milestone scope
matches any of these conditions:
- "Payments" / "monetization" / "checkout" milestones
- Revenue-enabling milestones following the order system
- Any milestone that mentions Stripe, billing, payouts, or tenant payments
- Compliance / KYC / financial-flow milestones

**Hard dependency: SEED-002 must ship first.** No order = nothing to charge for.

## Scope Estimate

**Large** — full milestone. Plan as ~4 phases:
1. Stripe Connect OAuth flow during tenant settings (or onboarding) — store
   `stripe_account_id` per tenant, handle disconnect
2. Payment intent creation per order with `application_fee_amount` and
   `transfer_data.destination = tenant_stripe_account_id`
3. Webhook handler scoped per connected account: `payment_intent.succeeded`,
   `payment_intent.payment_failed`, `charge.refunded`, `account.updated`
4. Tenant-side payment status UI in admin (recent charges, pending payouts —
   read from Stripe API, do not duplicate the data)

## Breadcrumbs

### In xmartmenu (current codebase):
- **No Stripe code yet** — confirmed by grep for `stripe|payment|checkout` in `src/`.
  This is greenfield.
- [src/types/database.ts](src/types/database.ts) — add `stripe_account_id`,
  `stripe_account_status`, `application_fee_pct` (or flat) columns to tenants table
- Tenant settings UI (path TBD) — Connect button + status indicator lives here
- [src/app/api/](src/app/api/) — new routes: `/api/stripe/connect/oauth`,
  `/api/stripe/webhook` (per-account event handler)
- Order creation flow from SEED-002 — payment intent is created here, attached to
  the order

### External references:
- Stripe Connect docs: https://stripe.com/docs/connect — start with the comparison
  page (Standard vs Express vs Custom) before choosing a flavor
- `application_fee_amount` + `transfer_data[destination]` is the platform-fee
  pattern — single charge, two splits

## Notes

- **Application fee model** — open question, decide during planning. Options:
  - Flat per-order fee (e.g. $0.30) — predictable, scales with order volume
  - % of order total (e.g. 1.5%) — scales with tenant revenue, more aligned but
    less predictable
  - Tiered per plan (free tier higher %, paid tier lower) — couples Connect to
    subscription billing
- **Refunds** — refund the charge minus our application fee, or refund proportionally?
  Stripe supports both; pick one and document it in the tenant agreement.
- **Payout schedule** — Stripe defaults work fine. Don't build payout UI on our side;
  link out to the tenant's Stripe dashboard.
- **PCI scope** — using Stripe Elements / hosted Checkout keeps us out of PCI
  scope. Do not collect card numbers on our domain.
- **Webhook idempotency** — events can fire twice. Use `stripe_event_id` as a
  dedup key in a small `processed_webhook_events` table.
- **Test mode** — every tenant connection should support test mode keys so we
  can dogfood without real charges.
