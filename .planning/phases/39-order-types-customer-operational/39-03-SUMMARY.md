---
phase: 39-order-types-customer-operational
plan: "03"
subsystem: admin-kds-ui
tags: [react, typescript, orders, kds, filter]

requires:
  - "39-01: migration 035 (order_type + delivery_address on orders)"
provides:
  - "OrderCard fulfillment badge (dine_in=blue, pickup=amber, delivery=purple)"
  - "OrdersClient order type filter row: All / Dine-In / Pick-Up / Delivery"
affects:
  - 40 (multi-location adds location_id filter alongside type filter)

tech-stack:
  added: []
  patterns:
    - "ORDER_TYPE_CONFIG dict lookup pattern — mirrors STATUS_COLORS shape"
    - "IIFE badge render — graceful fallback if order_type undefined"
    - "AND filter composition: byStatus filtered by orderTypeFilter"

key-files:
  created: []
  modified:
    - src/app/(admin)/orders/OrdersClient.tsx

key-decisions:
  - "(order as any).order_type cast — Order interface will have the field after migration 035 is applied; avoids TS error in remote env without node_modules"
  - "orderTypeFilter not persisted to localStorage — status filter persists, type filter is session-only (simpler UX)"
  - "Delivery address truncated to max-w-[120px] to avoid overflow in OrderCard header area"

duration: ~5min
completed: 2026-05-19
---

# Phase 39 Plan 03: Admin/KDS UI Summary

**OrderCard now shows a colored fulfillment badge; OrdersClient has a Type filter row (All / Dine-In / Pick-Up / Delivery) that works alongside the existing status filter.**

## Accomplishments

- `src/app/(admin)/orders/OrdersClient.tsx`:
  - `UtensilsCrossed` and `Truck` added to lucide-react import
  - `ORDER_TYPE_CONFIG`: badge colors + labels + icons for dine_in/pickup/delivery
  - `orderTypeFilter` state (`'all' | 'dine_in' | 'pickup' | 'delivery'`, default `'all'`)
  - `filteredOrders`: refactored to IIFE — AND logic: status filter then type filter
  - `OrderCard`: fulfillment badge rendered between header and customer name; delivery address shown inline for delivery orders
  - Type filter row added below status chips with same chip styling
