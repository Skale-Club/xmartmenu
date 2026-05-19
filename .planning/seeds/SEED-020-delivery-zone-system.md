---
id: SEED-020
status: completed
planted: 2026-05-19
planted_during: v2.2-milestone-execution
completed: 2026-05-19
completed_in: phase-47-delivery-zone-system
trigger_when: restaurant activates delivery mode (SEED-013) and needs zone-based pricing and structured address management
scope: large
---

# SEED-020: Robust Delivery Zone System

## Why This Matters

SEED-013 adds delivery as an order type with a single flat fee. Real delivery operations are zone-based: a customer 2 km away pays less than one 10 km away. Without zone pricing, restaurants either over-charge nearby customers (losing conversions) or under-charge distant ones (losing margin).

This seed makes delivery operationally complete:
1. **Zone-based pricing** — restaurant defines delivery zones by zipcode prefix, each with its own fee
2. **Structured address collection at checkout** — zipcode validated against the restaurant's active zones in real time
3. **Customer order panel by phone** (SEED-018 integration) — customer sees delivery status after placing an order, accessed via phone login
4. **No live GPS tracking** — out of scope; requires a driver app and real-time infrastructure. Delivery status is manually advanced by the restaurant staff, same as kitchen order statuses.

**Phone is the delivery anchor.** The customer provides their phone at checkout. This is how the restaurant contacts them if there's a problem, how the customer looks up their order status in the customer panel, and how the restaurant builds a delivery customer history. Every delivery order must have `customer_phone` — it is required, not optional.

## When to Surface

**Trigger:** when a tenant activates delivery mode and needs more than a flat fee; or when building customer-facing order tracking

Surface during `/gsd:new-milestone` when the scope involves:
- Delivery operations
- Zone-based pricing
- Address management at checkout
- Customer order tracking by phone

## Scope Estimate

**Large** — 5–8 days. Five independent phases:

### Phase A: Delivery zones — DB + admin CRUD
- New `delivery_zones` table: `(id, tenant_id, name, fee_cents, zipcode_prefixes TEXT[], is_active)`
- `zipcode_prefixes` is an array of prefix strings (e.g. `['1010', '1011']`). Prefix matching covers entire districts without enumerating every zipcode — a prefix of `'1010'` matches `10100-000`, `10101-000`, and so on.
- Admin UI: "Delivery Zones" section in settings (shown only when `delivery_enabled = true`)
  - CRUD for zones: name, fee, list of zipcode prefixes
  - Active/inactive toggle per zone
  - Warning shown if no zones are configured ("No delivery zones set up — using flat fee")
- RLS: same `tenant_id` isolation pattern as all other settings tables

### Phase B: Checkout address collection + zone validation
- Checkout form when `order_type = 'delivery'`: structured fields — `street_address`, `complement` (optional, e.g. apt number), `zipcode`, `city`
- On zipcode entry: real-time lookup against the tenant's active zones
  - Prefix match found → show zone name + fee, update cart total
  - No match → show "Delivery not available to this zipcode" and block order submission
- All address fields stored on the order: `delivery_street`, `delivery_complement`, `delivery_zipcode`, `delivery_city`
- **`customer_phone` is required for all delivery orders** — validated at checkout before submission

### Phase C: Delivery order management (restaurant side)
- KDS: delivery order cards show a distinct style — customer phone (last 4 digits), street address, zone name
- Orders view: delivery tab with full address, phone, and zone per order
- Status workflow extended for delivery: `pending → preparing → ready → out_for_delivery → delivered`
  - `out_for_delivery` is a new status between `ready` and `done` — manually set by the restaurant
  - Status changes are the same PATCH API as current order status updates
- Optional: delivery note field on the order — customer can leave "leave at door", "call on arrival"

### Phase D: Customer delivery tracking panel (SEED-018 integration)
- In the customer panel at `restaurantsite.com/me` (SEED-018), delivery orders show:
  - Full status workflow with visual indicator (preparing → ready → out for delivery → delivered)
  - Estimated delivery time if the restaurant has set one on the order
  - Items ordered + total paid (including delivery fee + tip if applicable)
  - Restaurant address and phone so the customer can call if needed
- Customer accesses the panel by logging in with the phone used at checkout
- No live GPS — status reflects the restaurant's manual status updates only
- Panel automatically refreshes every 30 seconds while an active delivery order is present (same Realtime pattern as KDS)

### Phase E: Flat fee fallback compatibility (SEED-013)
- If `delivery_enabled = true` but no active delivery zones are configured → fall back to the flat `delivery_fee_cents` from SEED-013
- Keeps SEED-013 working for simple restaurants that just want a flat fee
- Admin UI shows a banner: "You're using a flat delivery fee. Set up delivery zones to charge based on distance."

## Breadcrumbs

- `supabase/migrations/` — `delivery_zones` table, new columns on `orders` (`delivery_street`, `delivery_complement`, `delivery_zipcode`, `delivery_city`, `delivery_notes`, `customer_phone` index)
- `src/types/database.ts` — `DeliveryZone`, extended `Order` type
- `src/components/menu/CartModal.tsx` — delivery address form + real-time zipcode zone lookup
- `src/app/api/public/orders/route.ts` — zone validation before insert, store address fields, require `customer_phone`
- `src/app/api/admin/delivery-zones/route.ts` — new CRUD endpoint
- `src/app/(admin)/settings/store/StoreClient.tsx` — Delivery Zones section
- `src/app/(admin)/kds/` — delivery card variant
- `src/app/(admin)/orders/` — delivery address + phone in order detail modal
- `src/app/(public)/[slug]/me/` — customer panel delivery status (SEED-018 integration)
- `src/app/api/admin/orders/[id]/route.ts` — PATCH to advance to `out_for_delivery` status

## Notes

- **Depends on SEED-013 (order types)** — delivery must be enabled before zones are relevant.
- **Depends on SEED-018 (customer phone login)** — the customer panel and phone requirement on delivery orders both require SEED-018 to be implemented first.
- **Zipcode prefix matching is the right v1 model** — storing exact full zipcodes is brittle (cities have hundreds). A prefix like `'1010'` covers an entire district with one entry. Restaurants configure "Zone A = prefixes 1010, 1011, 1012" and it works without per-zipcode management.
- **`customer_phone` is mandatory for delivery** — validated at checkout. No phone = no delivery order. This is the data that lets the restaurant contact the customer and lets the customer track via the panel.
- **No SMS/push notifications in v1** — customer tracks via the panel by logging in with their phone. SMS status notifications (order confirmed, out for delivery) are a future seed.
- **SEED-017 (tips)** coordinate on total calculation: `total_cents = items_total + delivery_fee_cents + tip_cents`. The delivery fee comes from the matched zone fee when zones are configured, not the flat fee.
- **SEED-011 (multi-location)** coordinate: delivery zones are per-branch when branches are active — each branch serves its own geographic area. `delivery_zones.location_id FK` (nullable = applies to single-location tenant).
