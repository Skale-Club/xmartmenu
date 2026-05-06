# Requirements — v1.1 Orders

**Milestone:** v1.1 Orders
**Created:** 2026-05-06

## v1 Requirements

### Schema (database layer)

- [x] **ORD-01**: `product_option_groups` table exists with fields: id, product_id, tenant_id, name, type (single|multiple|half_and_half), required, min_selections, max_selections, price_rule (max|average|sum|fixed), position, translations JSONB
- [x] **ORD-02**: `product_options` table exists with fields: id, group_id, tenant_id, name, base_price (nullable), price_modifier, is_available, position, translations JSONB
- [x] **ORD-03**: `orders` table exists with fields: id, tenant_id, customer_name, customer_phone, status (pending|preparing|ready|done|cancelled), total, notes, created_at — RLS: tenant-scoped for admin read, public insert only if orders_enabled
- [x] **ORD-04**: `order_items` table exists with fields: id, order_id, product_id, product_name, quantity, unit_price, selected_options JSONB, notes — unit_price stores final resolved price (size + half-and-half already computed)

### Admin — product option groups

- [ ] **ORD-05**: Store admin can add option groups to a product (name, type, required, min/max_selections)
- [ ] **ORD-06**: Store admin can add/edit/delete individual options within a group (name, base_price or price_modifier, availability)
- [ ] **ORD-07**: Store admin can reorder option groups and options via position field

### Public menu — option selection

- [ ] **ORD-08**: Customer sees product option groups when opening a product detail
- [ ] **ORD-09**: Customer can select exactly one option from a `single`-type group (radio — required group blocks add-to-cart if unselected)
- [ ] **ORD-10**: Customer can select one or more options from a `multiple`-type group (checkboxes, respects min/max_selections)
- [ ] **ORD-11**: Customer can pick two flavors for a `half_and_half`-type group (two sequential selectors); price resolves via `max(half1.base_price, half2.base_price)` for the chosen size
- [ ] **ORD-12**: Customer can add product with resolved options and computed unit_price to cart

### Cart

- [ ] **ORD-13**: Customer can view cart popup at bottom of menu page with all items, quantities, and totals
- [ ] **ORD-14**: Customer can increment/decrement item quantity from cart (+/- controls)
- [ ] **ORD-15**: Customer can remove an item from cart
- [ ] **ORD-16**: Cart total recalculates automatically when items change

### Checkout

- [ ] **ORD-17**: Customer can enter name and phone number to place order
- [ ] **ORD-18**: Customer sees order confirmation screen after successful order (order id, items, total)
- [ ] **ORD-19**: Order is persisted to DB with all items and selected_options JSONB

### Tenant order management

- [ ] **ORD-20**: Store admin can view list of incoming orders sorted by date (most recent first)
- [ ] **ORD-21**: Store admin can update order status (pending → preparing → ready → done)

## Future Requirements (deferred from v1.1)

- Order push notifications (kitchen display / WhatsApp)
- Split-bill support
- Table-side ordering (table number field)
- Kitchen ticket printing
- Order history for customer (by phone number)
- Delivery address + delivery fee
- Order editing after placement
- Coupon / discount codes

## Out of Scope

- Payment processing — deferred to v1.2 (SEED-003 Stripe Connect)
- Allergen / dietary labels — v1.3+
- Multi-language option group names in public UI — i18n already stored in translations JSONB, display deferred
- Real-time order status updates for customer — deferred (polling or push later)

## Traceability

| REQ-ID | Phase | Status |
|---|---|---|
| ORD-01 | Phase 4 — Schema | Complete |
| ORD-02 | Phase 4 — Schema | Complete |
| ORD-03 | Phase 4 — Schema | Complete |
| ORD-04 | Phase 4 — Schema | Complete |
| ORD-05 | Phase 5 — Admin Options UI | Pending |
| ORD-06 | Phase 5 — Admin Options UI | Pending |
| ORD-07 | Phase 5 — Admin Options UI | Pending |
| ORD-08 | Phase 6 — Public Menu + Cart | Pending |
| ORD-09 | Phase 6 — Public Menu + Cart | Pending |
| ORD-10 | Phase 6 — Public Menu + Cart | Pending |
| ORD-11 | Phase 6 — Public Menu + Cart | Pending |
| ORD-12 | Phase 6 — Public Menu + Cart | Pending |
| ORD-13 | Phase 6 — Public Menu + Cart | Pending |
| ORD-14 | Phase 6 — Public Menu + Cart | Pending |
| ORD-15 | Phase 6 — Public Menu + Cart | Pending |
| ORD-16 | Phase 6 — Public Menu + Cart | Pending |
| ORD-17 | Phase 7 — Checkout | Pending |
| ORD-18 | Phase 7 — Checkout | Pending |
| ORD-19 | Phase 7 — Checkout | Pending |
| ORD-20 | Phase 8 — Tenant Orders View | Pending |
| ORD-21 | Phase 8 — Tenant Orders View | Pending |
