---
id: SEED-008
status: dormant
planted: 2026-05-07
planted_during: v1.4 (Performance milestone — phase 16, frontend-performance)
trigger_when: a tenant whose menu benefits from per-item ingredient customization comes online (burgers, pizzas, açaí, sushi, sanduíches, marmita) — or any milestone explicitly scoped to "personalização", "monte seu", "build your own", "totem-like ordering", "remove/extra ingredients", or "observação por item / instruções do cliente"
scope: medium
---

# SEED-008: Ingredient inclusion/removal + per-item custom instructions — McDonald's totem-style customization (opt-in per tenant)

## Why This Matters

The existing option-group system shipped in v1.1 (SEED-002) covers **structured
choices**: pick a size, pick a flavor, pick a half-and-half combo. It does not
cover the other half of restaurant customization, which the McDonald's totem
made the de-facto standard:

> *"Big Mac sem cebola, com bacon extra, queijo dobrado."*

That interaction is fundamentally different from option groups:

- The product has a **default ingredient list** (a Big Mac always ships with
  bun, two patties, lettuce, special sauce, cheese, pickles, onion).
- The customer **removes** items from that default list (free, typically).
- The customer **bumps quantity** of a default item ("queijo dobrado" → +R$X).
- The customer **adds** an extra ingredient from a master list ("adicionar
  bacon" → +R$Y).

Modelling this as another `product_option_group` works in theory but produces a
terrible UX: 8 separate "checkbox" groups, each pre-checked, no clear visual
hierarchy between "remove" and "add extra," no shared ingredient catalog across
products. Restaurants with even moderate ingredient overlap (a burger place
where bacon, cheese, egg appear on 12 different items) end up duplicating
options endlessly.

This needs its own primitive: a per-tenant **ingredients catalog** + a
`product_ingredients` join with a default flag and modifier prices, plus a
distinct UI on the customer side (a single panel of pre-checked chips with
+/− steppers, plus an "Adicionar ingrediente" button that opens the catalog).

### Two principles that drive the data model

1. **Ingredients are cataloged in parallel to products.** The admin gets a
   dedicated "Ingredientes" page — same level in the navigation as
   "Produtos," not nested inside it. Each ingredient is created once, with
   its own name, image (optional), default prices, and i18n. Linking an
   ingredient to a product is a separate operation done from the product
   editor via a **multi-select picker** that reads the catalog. This is
   the difference between a normalized catalog and a flat per-product
   options list — and it is the entire reason this is a new primitive
   instead of another option group.

2. **Cost is optional per ingredient.** Restaurants charge for some
   modifications and not others, on a case-by-case basis. *"Queijo extra
   +R$5"* and *"adicionar bacon +R$8"* coexist with *"sem cebola"* (free),
   *"adicionar ketchup"* (free), and *"trocar pão"* (free). The schema
   must let every price field be `0` (or `NULL` semantically equivalent),
   and the UI must hide the price chip when the cost is zero — showing
   "+R$0,00" next to "ketchup" looks broken. Price fields live on the
   ingredient catalog as defaults, with optional per-product overrides on
   the join (a kitchen might charge R$5 for extra cheese on a burger but
   R$3 on a hot dog).

**Crucially: this is opt-in per tenant.** A traditional Brazilian *cantina*
serving prato feito does not want customers picking apart the dish. A burger
joint, açaí bar, pizzeria, or *casa de marmita* absolutely does. So this ships
behind a tenant setting (`ingredient_customization_enabled`), same pattern as
`direct_orders_enabled` / `whatsapp_orders_enabled`.

### Companion feature: per-item free-text instructions

Even tenants who do *not* want a full ingredient catalog often want to let
customers leave a short note on each line item — *"ponto da carne mal
passado"*, *"sem gelo"*, *"embalar separado da bebida"*, *"alergia a
amendoim"*. Today the schema has `orders.notes TEXT` (order-level note,
shipped in migration 021) but no `order_items.notes` — so the customer can
only attach one blob of text to the whole order, not to a specific item.
That's a daily-driver gap operators will hit immediately once orders see
real volume.

This seed bundles that field in because the operational concerns are
identical: the kitchen ticket and KDS card have to render *some kind of
per-item modification text* clearly, whether the source is a structured
"SEM cebola" chip or a free-text "ponto mal passado." Solving both at once
means one display contract instead of two.

A separate, lighter tenant flag — `item_notes_enabled` — controls just the
free-text field, so a restaurant can enable item notes without committing
to the full ingredient catalog (Phase D below ships independently of A–C).

## When to Surface

**Trigger:** a tenant whose menu benefits from per-item ingredient
customization is onboarding (or asks for it), or a milestone is scoped to
"build your own" / "totem-like" / "personalização" UX

This seed should be presented during `/gsd:new-milestone` when the milestone
scope matches any of these conditions:
- "Customization" / "personalização" / "monte seu" / "build your own" milestones
- Burger / pizzeria / açaí / sushi / sanduíche-bar / marmita-style tenant
  rollouts where ingredient-level control is table stakes
- Any milestone explicitly comparing to McDonald's totem, iFood "monte seu",
  or Burger King "Whopper do seu jeito" patterns
- Customer-facing UX milestones that cite "options too rigid" or "customers
  can't say *no onions*" as a complaint
- Naturally pairs with SEED-007 (KDS dashboard) — when restaurants start
  reading live tickets in the kitchen, the ticket text needs to show
  modifications clearly ("SEM cebola, +bacon")

## Scope Estimate

**Medium** — one milestone, ~4 phases. New tables, new admin CRUD, new
customer UI panel, per-item notes column, plus integration into
cart/order/kitchen-ticket display. Phase D is independently shippable if
the tenant only wants free-text item notes.

Suggested phase breakdown:
1. **Phase A: schema + admin catalog**
   - New tables (target shape):
     ```sql
     -- ingredients: per-tenant master catalog, lives in parallel to products
     CREATE TABLE ingredients (
       id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
       name                  TEXT NOT NULL,
       image_url             TEXT,                      -- optional
       -- default prices; NULL or 0 == free. UI hides price chip when 0.
       default_extra_price   NUMERIC(10,2) DEFAULT 0,   -- charged when default-included ingredient qty > 1
       default_add_price     NUMERIC(10,2) DEFAULT 0,   -- charged when added as a non-default extra
       is_available          BOOLEAN NOT NULL DEFAULT true,
       position              INTEGER NOT NULL DEFAULT 0,
       translations          JSONB NOT NULL DEFAULT '{}'
     );

     -- product_ingredients: join — which catalog ingredients attach to which product
     CREATE TABLE product_ingredients (
       id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       product_id            UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
       ingredient_id         UUID NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
       tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
       is_default            BOOLEAN NOT NULL DEFAULT false,
       -- per-product overrides; NULL means "use the catalog default"
       extra_price_override  NUMERIC(10,2),
       add_price_override    NUMERIC(10,2),
       position              INTEGER NOT NULL DEFAULT 0,
       UNIQUE (product_id, ingredient_id)
     );
     CREATE INDEX idx_product_ingredients_product ON product_ingredients(product_id, tenant_id);
     ```
     `is_default = true` → ingredient is pre-included in the product (a
     burger's onion). `is_default = false` → ingredient is offered as an
     optional add-on (bacon a customer can add). Same row, just a flag.
   - Resolved-price rule: `extra_price_override IF NOT NULL ELSE
     ingredients.default_extra_price`. Same for `add_price`. **Zero (or
     NULL) is a valid, displayed-as-free price.**
   - New tenant setting: `ingredient_customization_enabled BOOLEAN` on
     `tenants` (or `store_settings`, matching existing flag patterns).
   - Admin pages:
     - **`/admin/menu/ingredients`** — top-level catalog page next to
       Products. Full CRUD: name, image (optional), default extra-price,
       default add-price, i18n via `translations`, availability toggle,
       drag-to-reorder.
     - **Per-product "Ingredientes" tab** in the product editor — a
       **multi-select picker** that lists every available ingredient in
       the catalog (search, scroll). For each selected ingredient: a
       toggle "Padrão do produto" (controls `is_default`), and two
       optional override fields ("Preço extra para este produto", "Preço
       para adicionar a este produto") that fall back to the catalog
       defaults when blank.
   - Hide all of the above behind the tenant flag — no UI noise for tenants
     who don't enable it.
2. **Phase B: customer-side customization panel**
   - On the product detail page (or cart-add modal), if
     `ingredient_customization_enabled` AND the product has any
     `product_ingredients`, render the customization panel below the
     option-groups section.
   - Default ingredients shown as pre-checked chips with a +/− stepper:
     `−1` removes ("SEM cebola"), `0` is default, `+1` is extra ("cebola
     extra +R$2"), `+2` is double, etc. (cap at a sensible max — 3?).
   - Below: "+ Adicionar ingrediente" button opens a sheet with available
     non-default catalog items the customer can add (each with its own price).
   - Live price recompute (reuse existing cart-price logic from SEED-002).
   - Persist into `order_items.ingredient_modifications` JSONB:
     ```json
     {
       "removed":  [{ "ingredient_id": "...", "name": "Cebola" }],
       "extras":   [{ "ingredient_id": "...", "name": "Queijo", "qty": 2, "unit_price": 3.00 }],
       "added":    [{ "ingredient_id": "...", "name": "Bacon",  "qty": 1, "unit_price": 5.00 }]
     }
     ```
   - `order_items.unit_price` already-resolved (same convention as SEED-002).
3. **Phase C: kitchen ticket + order display**
   - Order confirmation, admin orders table, and the SEED-007 KDS card must
     all render the modifications clearly:
     - Removed → strikethrough or a red "SEM cebola" line.
     - Extras → a "+queijo (2x)" line in a visible color.
     - Added → a "+bacon" line.
     - Free-text note (Phase D) → italic line, distinct icon
       (e.g. quote/speech-bubble), e.g. *"ponto mal passado"*.
   - This is the most operationally important step: a kitchen that misses
     "SEM cebola" — or a "alergia a amendoim" note — because the UI buried
     it is worse than no customization feature at all.
   - WhatsApp order export (`direct_orders_enabled` flow) must include both
     the structured modifications and the per-item free-text note in the
     message body.
4. **Phase D: per-item free-text instructions** *(independently shippable)*
   - New tenant setting: `item_notes_enabled BOOLEAN` on the same home as
     `ingredient_customization_enabled` (tenants vs store_settings —
     match precedent).
   - Schema: `ALTER TABLE order_items ADD COLUMN IF NOT EXISTS notes TEXT;`
     plus a tenant-configurable `notes_max_length` (default ~140 chars to
     keep kitchen tickets legible; restaurants who want longer can raise it).
   - Customer UI: a small "Observações" textarea on the product
     detail/cart-add modal, *below* the ingredient panel (or alone, if
     ingredient customization is off). Character counter, placeholder copy
     localized: *"Ex: ponto da carne, sem gelo, embalar separado…"*.
   - Validate on submit (server-side too): trim, length-cap, strip control
     chars. Store the trimmed value on `order_items.notes`.
   - Display: ticket/KDS/WhatsApp/order-history all render the note as
     described in Phase C, with a clear visual marker so the cook never
     misses it.
   - **Why independently shippable:** doesn't touch `ingredients`,
     `product_ingredients`, or the catalog admin pages. A tenant who turns
     on only `item_notes_enabled` gets the textarea; the full ingredient
     UI stays hidden. Lets a restaurant adopt the lighter primitive without
     committing to the catalog work.

## Breadcrumbs

### Existing infrastructure to build on:
- [supabase/migrations/021_orders_v11_schema.sql](supabase/migrations/021_orders_v11_schema.sql)
  — pattern for adding new tables with RLS + per-tenant policies + i18n
  `translations` JSONB. Copy this exactly for `ingredients` and
  `product_ingredients`.
- [supabase/migrations/008_whatsapp_orders_toggle.sql](supabase/migrations/008_whatsapp_orders_toggle.sql),
  [010_orders_enabled.sql](supabase/migrations/010_orders_enabled.sql),
  [018_direct_orders_enabled.sql](supabase/migrations/018_direct_orders_enabled.sql)
  — three precedents for tenant-level boolean flags. Pick the matching home
  (tenants vs store_settings) and follow conventions exactly.
- [src/types/database.ts](src/types/database.ts) — extend `Order`, `OrderItem`
  with `ingredient_modifications` and `notes` (per-item). Extend
  tenant/settings types with both flags
  (`ingredient_customization_enabled`, `item_notes_enabled`).
- [supabase/migrations/021_orders_v11_schema.sql](supabase/migrations/021_orders_v11_schema.sql)
  lines 24–26 — `orders.notes` (order-level) precedent. Mirror its
  `ADD COLUMN IF NOT EXISTS notes TEXT` shape for `order_items.notes` in
  Phase D.
- [src/components/menu/MenuPage.tsx](src/components/menu/MenuPage.tsx) — host
  for the customer-side product detail UI. Customization panel slots below
  the existing option-groups area (introduced by SEED-002 phase 1–2).
- [src/app/(admin)/menu/products/ProductsClient.tsx](src/app/(admin)/menu/products/ProductsClient.tsx)
  — host for the per-product "Ingredients" admin tab. The existing form's
  "Ingredients, preparation details..." placeholder (line 362) is currently
  just free-text in `description` — this seed replaces that placeholder
  freeform with structured data, but keep `description` as a fallback for
  tenants who don't enable customization.
- [src/components/admin/AdminSidebar.tsx](src/components/admin/AdminSidebar.tsx)
  — add an "Ingredientes" entry that only appears when the tenant flag is on.

### Related seeds:
- [SEED-002 (completed)](.planning/seeds/SEED-002-customer-order-system.md) —
  shipped `product_option_groups` + `product_options` + cart + order schema.
  This seed is the *complement*: option groups handle "pick one of N"
  decisions; this seed handles "tweak the defaults." Together they cover the
  full restaurant-customization surface.
- [SEED-007 (dormant)](.planning/seeds/SEED-007-restaurant-orders-dashboard-kds.md)
  — KDS card layout must reserve room for modification lines. Cleaner if
  SEED-008 ships first or in the same milestone, but not a hard dependency.

## Notes

- **Catalog reuse is the whole point.** The single biggest UX win over
  modelling everything as option groups is that "Bacon" is one row in
  `ingredients`, attached to 12 burgers via `product_ingredients` rows. Edit
  the price once, it propagates everywhere. Resist any design that ends up
  with per-product ingredient duplication.
- **Pricing model — keep it simple in v1.** Two prices per ingredient,
  defined once on the catalog (`default_extra_price`, `default_add_price`),
  optionally overridden per product on the join
  (`extra_price_override`, `add_price_override`). **Either field can be 0
  or NULL — meaning "free, no price chip on the customer UI."** Charging
  for "queijo extra +R$5" and offering "ketchup grátis" coexist on the
  same product without special-casing. Removal is always free in v1 —
  some restaurants charge "−R$2 sem queijo" but that's rare and adds
  checkout-display complexity. Defer.
- **Multi-select linking, not per-product CRUD.** The product editor's
  "Ingredientes" tab must read from the catalog and present a
  multi-select — never a "create ingredient inline" affordance on the
  product page. That would defeat the catalog's purpose and reintroduce
  the duplication problem. If a needed ingredient is missing, the admin
  goes to the catalog page, creates it, comes back. (A "+ novo
  ingrediente" shortcut that opens the catalog page in a new tab/sheet is
  fine UX, but the create itself happens in the catalog flow.)
- **i18n from day one.** Reuse the `translations JSONB` pattern from
  migration 012/021. Ingredient names are the most-translated strings on the
  menu — *Cebola / Onion / Cebolla*.
- **Don't overengineer.** Skip: nutrition info per ingredient, allergen
  tagging, swap-one-for-another rules, "no tomato but add cucumber" combo
  promos, attaching photos to per-item notes, voice notes, AI parsing of
  free-text into structured modifications. Those are obvious follow-ups
  but kill v1 scope. The MVP is: catalog → attach to product → +/− on
  customer side → store JSONB; plus a textarea → trim + length-cap →
  store TEXT.
- **Performance note.** `product_ingredients` is read on every product detail
  view — index `product_ingredients(product_id, tenant_id)` from day one.
  Lands cleanly after migration 024 (the index milestone in v1.4).
- **Status terminology in PT-BR.** Customer-facing UI strings should ship
  localized: `Sem`, `Extra`, `Dobrado`, `Adicionar ingrediente`,
  `Personalizar`. The catalog admin UI: `Ingredientes`, `Padrão do produto`,
  `Preço do extra`, `Preço para adicionar`.
- **Deliberately separate from option groups.** Do *not* reuse
  `product_option_groups.type = 'ingredients'`. The data shape, pricing
  semantics (delta vs base, default-on vs default-off), and UI affordances
  diverge enough that overloading one table will make both worse. New
  primitive, new tables.
- **Tenant gating discipline.** Every query that fetches ingredients in the
  customer-facing path must check `ingredient_customization_enabled` and
  short-circuit if off. Same for `item_notes_enabled` — no rendering of the
  textarea or the kitchen-ticket "observação" line for tenants who didn't
  opt in. Two independent flags, two independent gates.
- **Free-text safety.** `order_items.notes` is user-controlled text that
  ends up on a kitchen display, an admin table, and a WhatsApp message.
  Render with text-only (no HTML interpolation), strip control characters
  on insert, and length-cap server-side — not just client-side. Same
  hygiene we already apply to other customer-supplied strings.
- **Why ship the notes field with the ingredient seed instead of in its own
  seed.** They share the same display contract on the kitchen ticket, the
  same WhatsApp export format, the same admin-table column, and the same
  KDS card layout. Splitting them produces two seeds that touch the same
  six display surfaces — duplicated work and inconsistent UX. Bundling
  with an independently-shippable Phase D keeps the option to ship just
  the notes piece without forcing the ingredient catalog scope.
