---
id: SEED-019
status: dormant
planted: 2026-05-19
planted_during: v2.2-milestone-execution
trigger_when: restaurant wants different prices for online vs in-store, or wants to gate in-store menu behind phone login
scope: medium
---

# SEED-019: Public / Private Menu Modes

## Why This Matters

Restaurants frequently have two pricing realities: the price on their website (public, competitive, visible to anyone Googling them) and the price on the in-store menu (which may include service charge, table fee, or simply higher prices to account for operational costs). Today XmartMenu serves one menu to everyone.

**The model:**
- **Public menu** — accessible to anyone without login; shown at the restaurant's domain; the "website" menu; public prices
- **Private menu** — accessible only inside the restaurant via QR code; requires phone OTP login (SEED-018); in-store prices (can be different from public)

**How it works for the customer:**
- Arriving at `restaurantsite.com` → sees public menu, no login required
- Scanning the in-store QR code → if private menu is enabled, prompted to enter phone + OTP → logs in → sees private menu with in-store prices
- If they're already logged in (SEED-018 session), QR scan takes them straight to private menu

**For the restaurant:**
- Toggle per menu: Public or Private
- Same menu catalog, but prices can differ (a separate price field or price_modifier per menu mode)
- Multiple menus already supported in the data model — private menu is just a menu with `is_private: true` and a different price set

## When to Surface

**Trigger:** when a restaurant requests different online vs in-store pricing, or when implementing customer phone login (SEED-018)

Surface during `/gsd:new-milestone` when the scope involves:
- Multi-menu management
- In-store vs online pricing differentiation
- Private/members-only menu features
- QR code per menu type

## Scope Estimate

**Medium** — 3–5 days. Components:

### Phase A: Menu privacy flag + admin UI
- `menus` table: add `is_private BOOLEAN DEFAULT false`
- Admin menu list: toggle per menu to mark as Public or Private
- Private menu badge in admin UI
- Menu URL: public menus accessible without login; private menus redirect to phone login if no session

### Phase B: Routing and auth gate
- Middleware update: when accessing a menu route, check if `menu.is_private`
  - If private AND no customer session (SEED-018) → redirect to phone OTP login page
  - If private AND valid session → serve the menu
  - If public → serve directly (current behaviour)
- The login page for private menu access is scoped to the tenant (SEED-018 Phase B)

### Phase C: Per-menu pricing
- Products can have a price override per menu: new `product_menu_prices` table with `(product_id, menu_id, price_cents)` OR a simpler `menus.price_multiplier DECIMAL` (e.g. 1.15 = 15% markup on all items)
- v1: `price_multiplier` on the menu — simpler, no per-product price management overhead
- v2: per-product price overrides — more flexible, higher complexity
- Start with `price_multiplier` for v1

### Phase D: QR code per menu type
- Each menu can have its own QR code (already supported via menu slug)
- Restaurant prints public QR for table tents / door (goes to public menu)
- Restaurant prints private QR for in-store (goes to private menu → triggers login if needed)
- Admin QR code generator shows separate QR per menu

## Breadcrumbs

- `supabase/migrations/` — `menus.is_private`, `menus.price_multiplier`, future `product_menu_prices`
- `src/types/database.ts` — `Menu` interface receives `is_private`, `price_multiplier`
- `src/middleware.ts` — route guard for private menu access (check session before serving)
- `src/app/(public)/[slug]/[menuSlug]/page.tsx` — private menu auth gate
- `src/app/(admin)/menus/MenusClient.tsx` — Public/Private toggle per menu
- `src/lib/get-active-menu.ts` — menu fetch needs to respect `is_private` and apply `price_multiplier`
- `src/app/(public)/[slug]/[menuSlug]/login/` — new route for private menu phone login entry point

## Notes

- **Depends on SEED-018** — private menu access requires customer phone OTP login. Do not build the auth gate before the OTP system exists.
- **price_multiplier is the right v1 approach** — "in-store prices are 15% higher than website prices" is the common use case. Per-product overrides are complex to manage (100+ products × 2 menus = 200 price entries). Multiplier covers 90% of cases.
- **Public menu stays public** — a restaurant with only public menus has zero behaviour change. The feature is purely additive.
- **Multiple private menus** — a restaurant could have VIP, in-store, and staff menus each as separate private menus with different multipliers. The `is_private` flag + `price_multiplier` model supports this naturally.
- **QR code on the private menu** — the in-store QR should encode the direct menu URL (e.g. `restaurantsite.com/in-store`). The middleware intercepts and requests login. The URL itself doesn't need to contain auth tokens — the session handles it.
- **SEED-020 (delivery)** also benefits from the public/private split — a delivery menu (online, public prices) can be distinct from the dine-in menu (in-store, higher prices).
