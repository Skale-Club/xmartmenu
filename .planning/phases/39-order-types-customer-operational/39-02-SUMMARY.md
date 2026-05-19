---
phase: 39-order-types-customer-operational
plan: "02"
subsystem: customer-ui
tags: [react, typescript, menu, cart, order-types]

requires:
  - "39-01: migration 035 + API order_type support"
provides:
  - "CartModal order type selector (chips) + delivery address input + delivery fee display"
  - "MenuPage orderType + deliveryAddress state; submitOrder sends order_type + delivery_address"
affects:
  - 39-03 (orders saved with order_type are read by OrdersClient)

tech-stack:
  added: []
  patterns:
    - "Optional props pattern: all 5 new CartModal props are optional (?) — no breaking change"
    - "IIFE pattern for conditional chip rendering with activeTypes.length < 2 guard"
    - "Cents/dollars display: deliveryFeeCents / 100 in UI (same as StoreClient pattern)"

key-files:
  created: []
  modified:
    - src/components/menu/CartModal.tsx
    - src/components/menu/MenuPage.tsx

key-decisions:
  - "State in MenuPage (not CartModal) — submitOrder needs orderType and deliveryAddress in scope"
  - "Optional props on CartModal — existing callers unaffected; feature activates only when config passed"
  - "Chip selector hidden when only 1 type active — no noise for single-mode restaurants"

duration: ~5min
completed: 2026-05-19
---

# Phase 39 Plan 02: Customer UI Summary

**CartModal now shows order type chips when 2+ types active, delivery address input when delivery selected, and delivery fee breakdown in the summary card. State lives in MenuPage.**

## Accomplishments

- `src/components/menu/MenuPage.tsx`:
  - `orderTypeConfig` derived from `settings.dine_in_enabled/pickup_enabled/delivery_enabled/delivery_fee_cents`
  - `orderType` and `deliveryAddress` useState
  - `submitOrder`: validation blocks submission if delivery + no address
  - `submitOrder`: POST body includes `order_type` and `delivery_address`
  - Resets `orderType`/`deliveryAddress` on successful order
  - Passes 5 new props to CartModal

- `src/components/menu/CartModal.tsx`:
  - Added `UtensilsCrossed`, `Package`, `Truck`, `MapPin` to lucide-react import
  - 5 new optional props added to function signature
  - Order type selector: IIFE renders chips only when `activeTypes.length >= 2`
  - Delivery address input shown when `orderType === 'delivery'`
  - Summary card total section: when delivery + fee > 0, shows Subtotal + Delivery fee + Total rows; otherwise unchanged single Total row
