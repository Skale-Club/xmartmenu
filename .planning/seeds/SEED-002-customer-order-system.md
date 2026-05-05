---
id: SEED-002
status: dormant
planted: 2026-05-05
planted_during: pre-GSD (no .planning/STATE.md yet)
trigger_when: tenant onboarding is solid and at least one tenant has a populated menu to order from
scope: large
---

# SEED-002: Customer order system (cart + addons + quantity)

## Why This Matters

Today xmartmenu is a digital menu — customers can see items but cannot order. The
next obvious step is to let them actually place an order from the menu page. This
turns the product from a passive display into a transactional surface and unlocks
SEED-003 (Stripe payments).

The pattern is well-understood and we have a reference implementation to copy from:
the **skleanings service-booking system** at `C:\Users\Vanildo\Dev\skleanings`.
Its booking flow is structurally identical to a restaurant order — base item +
addons + quantity → cart → checkout → confirmation. Reusing that architecture
saves design time and lets us focus on menu-specific concerns (modifiers,
allergens, kitchen tickets) instead of re-solving cart state.

## When to Surface

**Trigger:** tenant onboarding is solid and at least one tenant has a populated menu to order from

This seed should be presented during `/gsd:new-milestone` when the milestone scope
matches any of these conditions:
- "Orders" / "ordering" / "checkout" milestones
- Customer-facing transactional features
- Revenue / monetization milestones (orders are prerequisite for taking money)
- Any milestone that mentions cart, basket, addons, or modifiers

## Product Variations & Half-and-Half

Restaurant menus require structured option groups — not a flat list of addons.
Two real-world cases drive the design:

**Case A — Sizes (single required selection):**
Pizza Margherita: Pequena R$35 · Média R$45 · Grande R$55. Customer *must* pick
one. The selected size sets the base price (not a delta).

**Case B — Meio a meio (half-and-half):**
Customer picks two flavors for each half of one pizza. Price rule is typically
`max(price_half1, price_half2)` for the chosen size. This is a UI-distinct
interaction: two sequential flavor selectors, not a checkbox list.

### Schema: option groups

```sql
-- product_option_groups: e.g. "Tamanho", "Borda Recheada", "Sabores"
CREATE TABLE product_option_groups (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  type             TEXT NOT NULL
    CHECK (type IN ('single', 'multiple', 'half_and_half')),
  required         BOOLEAN NOT NULL DEFAULT false,
  min_selections   INTEGER NOT NULL DEFAULT 0,
  max_selections   INTEGER NOT NULL DEFAULT 1,
  price_rule       TEXT NOT NULL DEFAULT 'max'
    CHECK (price_rule IN ('max', 'average', 'sum', 'fixed')),
  position         INTEGER NOT NULL DEFAULT 0,
  translations     JSONB NOT NULL DEFAULT '{}'
);

-- product_options: individual choices within a group
CREATE TABLE product_options (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         UUID NOT NULL REFERENCES product_option_groups(id) ON DELETE CASCADE,
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  -- base_price: set by this option (e.g. Grande = R$55); null = use product.price
  base_price       NUMERIC(10,2),
  -- price_modifier: additive delta (e.g. borda recheada +R$5)
  price_modifier   NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_available     BOOLEAN NOT NULL DEFAULT true,
  position         INTEGER NOT NULL DEFAULT 0,
  translations     JSONB NOT NULL DEFAULT '{}'
);
```

`type = 'single'` → radio; exactly one selection; `base_price` replaces the
product price.  
`type = 'multiple'` → checkboxes; `price_modifier` accumulates on top.  
`type = 'half_and_half'` → two flavor slots; `price_rule` determines the charge
(`max` is the Brazilian convention).

### order_items.selected_options shape

```json
{
  "groups": [
    {
      "group_id": "...", "name": "Tamanho", "type": "single",
      "selections": [
        { "option_id": "...", "name": "Grande", "base_price": 55.00 }
      ]
    },
    {
      "group_id": "...", "name": "Sabores", "type": "half_and_half",
      "price_rule": "max",
      "selections": [
        { "option_id": "...", "name": "Calabresa", "half": 1, "base_price": 55.00 },
        { "option_id": "...", "name": "Mussarela", "half": 2, "base_price": 50.00 }
      ],
      "resolved_price": 55.00
    }
  ]
}
```

`order_items.unit_price` stores the final resolved price (already includes size
and half-and-half logic) so repricing never depends on re-reading option tables.

## Scope Estimate

**Large** — full milestone. Cart context + UI components + option-group schema +
orders schema + checkout flow + confirmation page. Plan as ~4 phases:
1. Schema (orders, order_items, product_option_groups, product_options) + option-group UI on item detail
2. Cart context + cart popup + +/- quantity controls + half-and-half selector
3. Checkout flow (review → place order)
4. Order confirmation + tenant-side order list

## Breadcrumbs

### In xmartmenu (current codebase):
- [src/components/menu/MenuPage.tsx](src/components/menu/MenuPage.tsx) — main menu UI; cart popup attaches here
- [src/lib/get-active-menu.ts](src/lib/get-active-menu.ts) — menu data shape, addons must extend it
- [supabase/migrations/010_orders_enabled.sql](supabase/migrations/010_orders_enabled.sql) — orders feature flag already exists
- [supabase/migrations/018_direct_orders_enabled.sql](supabase/migrations/018_direct_orders_enabled.sql) — direct-orders flag scaffolding
- [src/types/database.ts](src/types/database.ts) — extend with new tables

### Reference implementation in skleanings (`C:\Users\Vanildo\Dev\skleanings`):
- `client/src/context/CartContext.tsx` — React Context cart state. In-memory only until
  checkout. CartItem shape: `{ quantity, calculatedPrice, priceBreakdown,
  selectedOptions, customerNotes }`. Methods: `addItem`, `updateQuantity`, `removeItem`,
  `getCartItemsForBooking()` (formats for API submission)
- `client/src/components/pricing/OptionsSelector.tsx` — addon checkbox + Lucide
  Plus/Minus quantity control pattern. `onChange` callback recalculates parent's
  `calculatedPrice`
- `client/src/components/CartSummary.tsx` — bottom-of-page cart popup pattern
- `server/routes/bookings.ts` — order creation API + Zod validation pattern
- DB tables to mirror:
  - `services` → menu items (already exist as `products`)
  - `serviceOptions` → `product_option_groups` + `product_options` (replaces flat
    `menu_item_options`; see "Product Variations & Half-and-Half" section above)
  - `bookings` → `orders` (customer_name, customer_phone, total, status)
  - `bookingItems` → `order_items` (order_id, product_id, product_name, quantity,
    unit_price, selected_options JSONB, notes TEXT)

## Notes

- **Stack alignment check**: skleanings is React + Vite + Wouter + React Query +
  React Context. xmartmenu is Next.js (App Router) — context pattern still works
  but needs `'use client'` boundaries. CartContext lives in client tree only.
- Don't overengineer: in-memory cart (no localStorage, no server-side cart) is
  fine for v1 — matches skleanings and avoids state-sync complexity.
- The menu-page cart popup pattern (CartSummary at bottom) is mobile-first and
  worth copying exactly.
- Defer: split-bill, table-side ordering, kitchen tickets, order status push.
  Those are obvious follow-ups but not v1.
- This seed must ship before SEED-003 (Stripe Connect) — payment needs an order
  to charge for.
