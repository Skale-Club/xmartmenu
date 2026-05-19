---
id: SEED-013
status: completed
completed: 2026-05-19
planted: 2026-05-19
completed_in: v2.2 (Restaurant Growth Platform — phases 38-39)
planted_during: post-v2.1-custom-domains
trigger_when: a tenant wants to offer counter pickup or delivery in addition to dine-in
scope: small
---

# SEED-013: Order Type Selector (Dine-in / Pick-up / Delivery)

## Why This Matters

Today XmartMenu assumes every order is dine-in. There's no distinction between a customer sitting at a table, one wanting to pick up at the counter, or one ordering from home. This limitation shuts out a significant share of potential orders.

The proposal: the restaurant defines in settings which fulfillment modes it offers — each is an independent toggle. The customer sees a selector before or during checkout and picks how they want to receive their order. The order arrives in the KDS with the fulfillment type visible, enabling correct prioritization.

**Business rules:**
- **Dine-in** (default) — active by default on every new tenant; customer eats on-site
- **Pick-up** — customer collects at the counter; restaurant can set an ETA
- **Delivery** — delivered to an address; requires delivery address field at checkout; can have a delivery fee

The customer only sees the modes the restaurant has enabled. If only dine-in is active, the selector doesn't render at all — zero friction for the current flow.

## When to Surface

**Trigger:** when a tenant requests pickup or delivery support; or when evolving the checkout flow

Surface during `/gsd:new-milestone` when the scope involves:
- Expanding sales channels (pick-up, delivery)
- Improved checkout experience
- Delivery marketplace integration (iFood, Rappi) — order type is a prerequisite
- Per-channel sales reporting

## Scope Estimate

**Small** — 1–2 days. Components:

1. **DB migration**
   - `tenant_settings`: add `dine_in_enabled BOOLEAN DEFAULT true`, `pickup_enabled BOOLEAN DEFAULT false`, `delivery_enabled BOOLEAN DEFAULT false`
   - `tenant_settings`: `pickup_eta_minutes INT` (estimated pickup time, default 20)
   - `tenant_settings`: `delivery_fee_cents INT` (delivery fee in cents, 0 = free)
   - `orders`: add `order_type TEXT CHECK (order_type IN ('dine_in', 'pickup', 'delivery'))`, `delivery_address TEXT`

2. **Admin UI — Settings**
   - New "Order Types" section in `/admin/settings/store`
   - Toggle per mode (dine-in, pick-up, delivery)
   - "Estimated pickup time (minutes)" field, conditional on pick-up being active
   - "Delivery fee ($)" field, conditional on delivery being active
   - Validation: at least 1 mode must remain active

3. **Customer UX — checkout selector**
   - `OrderTypeSelector` component rendered only when more than 1 type is active
   - Dine-in selected by default when active
   - If only dine-in is active: selector does not render (zero friction for current behavior)
   - Delivery: reveals "Delivery address" field (required) + shows delivery fee in cart summary
   - Pick-up: shows ETA configured by the restaurant ("Ready in ~20 min")

4. **KDS + Orders view**
   - Badge per order type on KDS cards: `🍽 Dine-in` / `🥡 Pick-up` / `🛵 Delivery`
   - Filter by type in the admin orders view

5. **Total calculation**
   - Delivery: `total_cents = items_total + delivery_fee_cents`
   - Dine-in / Pick-up: no additional fee

## Breadcrumbs

- `src/app/(public)/[slug]/` — `MenuPage.tsx`, `CartModal.tsx`, `ProductModal.tsx` — checkout lives here
- `src/app/api/public/orders/route.ts` — order insert; needs `order_type` + `delivery_address`
- `src/app/(admin)/settings/store/` — tenant settings, where the new section lives
- `src/app/(admin)/kds/` — KDS cards that need the fulfillment type badge
- `src/app/(admin)/orders/` — orders list with the new filter
- `src/types/database.ts` — `TenantSettings` and `Order` receive the new fields
- `supabase/migrations/` — migration for new fields on `tenant_settings` and `orders`

## Notes

- **Dine-in as immutable default** — dine-in starts active and the UI must prevent all three from being disabled simultaneously. Validate before save.
- **Delivery ≠ iFood integration** — this is the "deliver to address, operated by the restaurant itself" channel. Marketplace integrations are a separate future seed.
- **Delivery address** — free-text field (no zip code validation) for v1. Geolocation and map are phase 2.
- **Plan gating** — delivery with a fee could be restricted to higher-tier plans. Evaluate at implementation time alongside SEED-009 (plans).
- **SEED-011 (multi-location)** — when multiple branches exist, pick-up and delivery need to know which branch the order ships from. Coordinate `location_id` + `order_type`.
