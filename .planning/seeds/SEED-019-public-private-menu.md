---
id: SEED-019
status: dormant
planted: 2026-05-19
planted_during: v2.2-milestone-execution
trigger_when: restaurant wants different prices for online vs in-store, or wants to gate the in-store menu behind phone login
scope: medium
---

# SEED-019: Public / Private Menu Modes

## Why This Matters

Restaurants frequently operate with two pricing realities: the price shown on their website (public, competitive, visible to anyone searching online) and the price on the in-store menu (which may include a service charge, table fee, or simply higher prices to account for operational costs). Today XmartMenu serves one menu to everyone regardless of context.

**The model:**
- **Public menu** — accessible to anyone without login; the "website" menu; public prices
- **Private menu** — accessible only inside the restaurant via QR code; requires phone OTP login (SEED-018); in-store prices that can differ from the public menu

**How it works for the customer:**
- Visiting `restaurantsite.com` → sees the public menu, no login required
- Scanning the in-store QR code → if the menu is private, prompted to enter phone + OTP → logs in → sees in-store menu with in-store prices
- If already logged in (SEED-018 session active), QR scan takes them straight to the private menu

**For the restaurant:**
- A toggle per menu: Public or Private
- Same product catalog, but prices can differ via a price multiplier on the menu
- Multiple menus already supported in the data model — a private menu is just a menu with `is_private: true` and an optional `price_multiplier`

## When to Surface

**Trigger:** when a restaurant requests different online vs in-store pricing, or when implementing customer phone login (SEED-018)

Surface during `/gsd:new-milestone` when the scope involves:
- Multi-menu management
- Online vs in-store pricing differentiation
- Private or members-only menu features
- QR code per menu type

## Scope Estimate

**Medium** — 3–5 days. Four independent phases:

### Phase A: Menu privacy flag + admin UI
- `menus` table: add `is_private BOOLEAN DEFAULT false` and `price_multiplier DECIMAL DEFAULT 1.00`
- Admin menu list: toggle per menu to mark as Public or Private
- Private menu badge in admin panel
- Menu URL: public menus accessible without login; private menus redirect to phone login if no session exists

### Phase B: Routing and auth gate
- Middleware update: when accessing a menu route, check `menu.is_private`
  - Private + no customer session → redirect to phone OTP login page (SEED-018)
  - Private + valid session → serve the menu
  - Public → serve directly (current behaviour, no change)
- The login page is scoped to the tenant domain

### Phase C: Per-menu pricing via multiplier
- `price_multiplier` on the menu applies to all product prices at render time
- Example: `price_multiplier = 1.15` means in-store prices are 15% higher than catalog prices
- No per-product price overrides in v1 — a single multiplier covers the most common use case (uniform markup)
- Per-product overrides (different price per product per menu) are a future phase when the data complexity is justified

### Phase D: QR code per menu type
- Each menu already has its own slug and therefore its own URL
- Admin QR code generator shows a separate QR per menu
- Restaurant prints the public QR for the website/door sign and the private QR for in-store table tents
- The private QR URL triggers the auth gate automatically

## Breadcrumbs

- `supabase/migrations/` — `menus.is_private`, `menus.price_multiplier`
- `src/types/database.ts` — `Menu` interface receives `is_private`, `price_multiplier`
- `src/middleware.ts` — route guard for private menu access (check customer session before serving)
- `src/app/(public)/[slug]/[menuSlug]/page.tsx` — private menu auth gate
- `src/app/(admin)/menus/MenusClient.tsx` — Public/Private toggle + price multiplier input per menu
- `src/lib/get-active-menu.ts` — apply `price_multiplier` to product prices before rendering
- `src/app/(public)/[slug]/[menuSlug]/login/` — new route for private menu phone login entry point

## Notes

- **Depends on SEED-018** — private menu access requires customer phone OTP login. Do not build the auth gate before the OTP system exists.
- **price_multiplier is the right v1 approach** — "in-store prices are 15% higher than website prices" covers the vast majority of restaurant use cases. Per-product overrides require managing 100+ price entries (one per product per menu) and are rarely needed for a flat markup.
- **Public menu stays public** — a restaurant that never creates a private menu has zero behaviour change. This feature is purely additive.
- **Multiple private menus are naturally supported** — a restaurant could have a VIP menu, an in-store menu, and a staff menu, each as a separate private menu with different multipliers. The `is_private + price_multiplier` model handles this without extra schema changes.
- **QR code security** — the private QR URL contains no auth tokens; it just points to the menu route. The middleware intercepts and enforces login. The URL is safe to print on physical materials.
- **SEED-020 (delivery)** also benefits from this split — a delivery menu (online, public prices) can be a distinct public menu while the dine-in menu is private with in-store pricing.
