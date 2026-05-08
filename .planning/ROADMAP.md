# Roadmap: xmartmenu

## Milestones

- ✅ **v1.0 Foundation** — Phases 1-3 (shipped 2026-05-06)
- ✅ **v1.1 Orders** — Phases 4-8 (shipped 2026-05-06)
- ✅ **v1.2 AI Onboarding** — Phases 9-11 (shipped 2026-05-07)
- ✅ **v1.3 Landing Page** — Phases 12-13 (shipped 2026-05-07)
- ✅ **v1.4 Performance** — Phases 14-17 (shipped 2026-05-08)
- ✅ **v1.5 Image Optimization** — Phases 18-20 (shipped 2026-05-08)
- ✅ **v1.6 Operations** — Phases 21-22 (shipped 2026-05-08)
- 🔄 **v1.7 Customization** — Phases 23-25 (in progress)

## Phases

- [ ] **Phase 23: Ingredient Schema** - DB migration, TypeScript types, and RLS policies for ingredients, product_ingredients join, tenant flag, and order_items JSONB column
- [ ] **Phase 24: Admin Catalog** - Admin ingredients CRUD page and product editor "Ingredientes" tab, both gated by tenant flag
- [ ] **Phase 25: Customer + Kitchen** - Customer customization panel in ProductModal, cart→API→DB persistence of modifications, and KDS/admin rendering of SEM/extra/added ingredients

## Phase Details

### Phase 23: Ingredient Schema
**Goal**: The database has a normalized ingredient catalog per tenant, products can declare their ingredient composition, and orders can store structured ingredient modifications — all with RLS isolation and correct TypeScript types
**Depends on**: Phase 22 (migration 025 baseline)
**Requirements**: INGR-01, INGR-02, INGR-03, INGR-04
**Success Criteria** (what must be TRUE):
  1. Migration applies cleanly with IF NOT EXISTS guards; `ingredients` table exists with all specified columns and RLS policy scoped to tenant_id
  2. `product_ingredients` join table exists with UNIQUE(product_id, ingredient_id) constraint, index on (product_id, tenant_id), and RLS scoped to tenant_id
  3. `tenant_settings.ingredient_customization_enabled` column exists and defaults to false; existing tenants are unaffected
  4. `order_items.ingredient_modifications` JSONB column exists, accepts null, and the TypeScript `OrderItem` type reflects it
  5. All four new/extended DB entities have TypeScript types in `src/types/database.ts` matching the column definitions
**Plans**: TBD

### Phase 24: Admin Catalog
**Goal**: A store admin with `ingredient_customization_enabled` active can manage their ingredient catalog and assign ingredients to products with per-product price overrides
**Depends on**: Phase 23
**Requirements**: INGR-05, INGR-06
**Success Criteria** (what must be TRUE):
  1. Navigating to `/admin/menu/ingredients` shows an ingredients list with create/edit/delete controls; the page is not accessible (hidden or 404) when `ingredient_customization_enabled` is false
  2. Admin can create an ingredient with name, default_extra_price, default_add_price, and availability toggle; the new ingredient appears in the list immediately
  3. Admin can drag-to-reorder ingredients in the catalog; position persists across page reload
  4. Opening the product editor at `/admin/menu/products/[id]` shows an "Ingredientes" tab when the flag is enabled; the tab contains a multi-select picker listing all tenant ingredients
  5. Selecting ingredients on the product tab persists the association; each associated ingredient shows `is_default` toggle and optional price override fields; empty overrides fall back to catalog defaults
**Plans**: TBD
**UI hint**: yes

### Phase 25: Customer + Kitchen
**Goal**: Customers can customize ingredient composition of a product and see a live price update; modifications are stored on the order and displayed visually in both the KDS card and the admin orders modal
**Depends on**: Phase 24
**Requirements**: INGR-07, INGR-08, INGR-09, INGR-10
**Success Criteria** (what must be TRUE):
  1. When `ingredient_customization_enabled` is true and a product has `product_ingredients`, the ProductModal shows a customization panel below option groups with chips for each default ingredient (stepper −/0/+) and an "Adicionar ingrediente" button listing non-default available ingredients
  2. Adjusting any ingredient chip updates the displayed total price in real time; removal is free; extra/add quantity shows "+R$X,XX" cost badge only when unit_price > 0
  3. Placing an order with modifications writes `ingredient_modifications` JSONB to `order_items` with the structure `{removed:[...], extras:[...], added:[...]}`; a product ordered with no modifications stores null or an empty/omitted field
  4. KDS card displays ingredient modifications with "SEM [name]" in red/strikethrough for removals, "+[qty] [name]" in amber for extras, and "[name]" in green for additions — visually distinct from item notes
  5. Admin orders modal renders the same ingredient modification summary alongside selected_options and notes, so staff can read the full order without opening the KDS
**Plans**: TBD
**UI hint**: yes

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 23. Ingredient Schema | 0/? | Not started | - |
| 24. Admin Catalog | 0/? | Not started | - |
| 25. Customer + Kitchen | 0/? | Not started | - |

## Completed Milestones

<details>
<summary>✅ v1.0 Foundation (Phases 1-3) — SHIPPED 2026-05-06</summary>

See `.planning/milestones/v1.0-ROADMAP.md` for full details.

</details>

<details>
<summary>✅ v1.1 Orders (Phases 4-8) — SHIPPED 2026-05-06</summary>

See `.planning/milestones/v1.1-ROADMAP.md` for full details.

</details>

<details>
<summary>✅ v1.2 AI Onboarding (Phases 9-11) — SHIPPED 2026-05-07</summary>

See `.planning/milestones/v1.2-ROADMAP.md` for full details.

</details>

<details>
<summary>✅ v1.3 Landing Page (Phases 12-13) — SHIPPED 2026-05-07</summary>

See `.planning/milestones/v1.3-ROADMAP.md` for full details.

</details>

<details>
<summary>✅ v1.4 Performance (Phases 14-17) — SHIPPED 2026-05-08</summary>

See `.planning/milestones/v1.4-ROADMAP.md` for full details.

</details>

<details>
<summary>✅ v1.5 Image Optimization (Phases 18-20) — SHIPPED 2026-05-08</summary>

See `.planning/milestones/v1.5-ROADMAP.md` for full details.

</details>

<details>
<summary>✅ v1.6 Operations (Phases 21-22) — SHIPPED 2026-05-08</summary>

| # | Phase | Plans | Status |
|---|---|---|---|
| 21 | KDS Dashboard | 2/2 | ✅ 2026-05-08 |
| 22 | Realtime + Per-Item Notes | 2/2 | ✅ 2026-05-08 |

See `.planning/milestones/v1.6-ROADMAP.md` for full details.

</details>
