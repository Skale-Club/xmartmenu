# Roadmap: xmartmenu

## Milestones

- ✅ **v1.0 Foundation** — Phases 1-3 (shipped 2026-05-06)
- 🚧 **v1.1 Orders** — Phases 4-8 (in progress)

## Completed Milestones

<details>
<summary>✅ v1.0 Foundation (Phases 1-3) — SHIPPED 2026-05-06</summary>

| # | Phase | Plans | Status |
|---|---|---|---|
| 1 | Performance | 2/2 | ✅ 2026-05-06 |
| 2 | Security | 3/3 | ✅ 2026-05-06 |
| 3 | CI/CD | 1/1 | ✅ 2026-05-06 |

See `.planning/milestones/v1.0-ROADMAP.md` for full details.

</details>

---

## 🚧 v1.1 Orders (In Progress)

**Milestone Goal:** Customers can place orders from the public menu — with product option groups (sizes, toppings, half-and-half), an in-memory cart, checkout, and tenant-side order management.

## Phases

- [x] **Phase 4: Schema** — All database tables for orders and product options exist with correct structure, RLS, and TypeScript types
- [x] **Phase 5: Admin Product Options UI** — Store admin can configure option groups and options per product (sizes, toppings, half-and-half)
- [ ] **Phase 6: Public Menu: Option Selectors + Cart** — Customers can select product options and add items to an in-memory cart shown as a popup at the bottom of the menu page
- [ ] **Phase 7: Checkout** — Customer enters name and phone and places order; receives confirmation screen
- [ ] **Phase 8: Tenant Orders View** — Store admin sees incoming orders and can update their status

## Phase Details

### Phase 4: Schema
**Goal**: All database tables for orders and product options exist with correct structure, RLS, and TypeScript types
**Depends on**: Phase 3 (v1.0 CI/CD)
**Requirements**: ORD-01, ORD-02, ORD-03, ORD-04
**Success Criteria** (what must be TRUE):
  1. Supabase migration creates product_option_groups, product_options, orders, and order_items tables with all specified fields and constraints
  2. RLS policies enforce: tenant admin can read/write their orders; public can insert orders only if orders_enabled=true; public can read product options
  3. src/types/database.ts is extended with all 4 new table types
  4. npm run build passes with no type errors related to the new types
**Plans**: 2 plans

Plans:
- [x] 04-01-PLAN.md — SQL migration 021: ALTER orders/order_items + CREATE product_option_groups/product_options with RLS
- [x] 04-02-PLAN.md — TypeScript types: update Order/OrderItem, add ProductOptionGroup/ProductOption, verify build

### Phase 5: Admin Product Options UI
**Goal**: Store admin can configure option groups and options per product (sizes, toppings, half-and-half)
**Depends on**: Phase 4
**Requirements**: ORD-05, ORD-06, ORD-07
**Success Criteria** (what must be TRUE):
  1. Product detail/edit page shows an option groups section listing all groups for that product
  2. Admin can create a group with name, type (single/multiple/half_and_half), required flag, and min/max selections
  3. Admin can add options to each group with name and base_price or price_modifier, and toggle availability
  4. Admin can delete option groups and individual options
  5. Position ordering works (↑↓ controls) for both groups and options
**Plans**: 3 plans

Plans:
- [x] 05-01-PLAN.md — Entry point: update Edit button to navigate + create [id]/page.tsx server component
- [x] 05-02-PLAN.md — ProductDetailClient.tsx shell: product fields form + option groups display with collapsed rows
- [x] 05-03-PLAN.md — Inline forms + CRUD mutations + position reordering (OptionGroupForm, OptionForm, moveGroup, moveOption)

### Phase 6: Public Menu: Option Selectors + Cart
**Goal**: Customers can select product options and add items to an in-memory cart shown as a popup at the bottom of the menu page
**Depends on**: Phase 5
**Requirements**: ORD-08, ORD-09, ORD-10, ORD-11, ORD-12, ORD-13, ORD-14, ORD-15, ORD-16
**Success Criteria** (what must be TRUE):
  1. Product modal shows option groups with appropriate selector UI: radio buttons for single groups, checkboxes for multiple groups, two sequential flavor selectors for half_and_half groups
  2. Required single groups block the "Add to cart" button until a selection is made
  3. Half-and-half group resolves price as max(half1.base_price, half2.base_price) and displays the computed price before adding to cart
  4. CartContext ('use client' React Context) wraps the menu page and holds in-memory cart state
  5. Cart popup appears at the bottom of the menu page when the cart contains at least one item
  6. +/- controls in the cart change item quantity; individual items can be removed
  7. Cart total updates in real time as items or quantities change
**Plans**: TBD
**UI hint**: yes

### Phase 7: Checkout
**Goal**: Customer enters name and phone and places order; receives confirmation screen
**Depends on**: Phase 6
**Requirements**: ORD-17, ORD-18, ORD-19
**Success Criteria** (what must be TRUE):
  1. "Place order" button opens a checkout form requesting customer name and phone (no payment fields)
  2. POST /api/orders creates the order record and all order_items with selected_options JSONB persisted
  3. Confirmation screen displays the order id, all ordered items, and the total
  4. Cart clears automatically after a successful order submission
  5. Existing orders API validates tenant existence and orders_enabled flag before inserting (already done in v1.0)
**Plans**: TBD
**UI hint**: yes

### Phase 8: Tenant Orders View
**Goal**: Store admin sees incoming orders and can update their status
**Depends on**: Phase 7
**Requirements**: ORD-20, ORD-21
**Success Criteria** (what must be TRUE):
  1. /admin/orders page lists all orders for the tenant sorted newest first
  2. Each order row shows customer name, phone, items summary, total, current status, and creation time
  3. Admin can advance an order through statuses: pending → preparing → ready → done
  4. Status changes persist to the database immediately without a page reload
**Plans**: TBD
**UI hint**: yes

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Performance | v1.0 | 2/2 | Complete | 2026-05-06 |
| 2. Security | v1.0 | 3/3 | Complete | 2026-05-06 |
| 3. CI/CD | v1.0 | 1/1 | Complete | 2026-05-06 |
| 4. Schema | v1.1 | 2/2 | Complete | 2026-05-06 |
| 5. Admin Product Options UI | v1.1 | 3/3 | Complete | 2026-05-06 |
| 6. Public Menu: Option Selectors + Cart | v1.1 | 0/? | Not started | - |
| 7. Checkout | v1.1 | 0/? | Not started | - |
| 8. Tenant Orders View | v1.1 | 0/? | Not started | - |
