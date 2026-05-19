---
phase: 39-order-types-customer-operational
plan: "01"
subsystem: schema-api
tags: [sql, typescript, supabase, orders, migration]

requires:
  - "38-01: migration 034 (order type flags on tenant_settings)"
provides:
  - "Migration 035: order_type + delivery_address columns on orders table"
  - "Updated POST /api/orders: validates order_type, enforces delivery_address, adds delivery fee server-side"
  - "Order TypeScript interface: order_type + delivery_address fields"
affects:
  - 39-02 (CartModal reads order_type from submit result)
  - 39-03 (OrderCard reads order_type + delivery_address from DB)

tech-stack:
  added: []
  patterns:
    - "Server-side fee enforcement: delivery_fee_cents fetched from tenant_settings, never trusted from client"
    - "IF NOT EXISTS guard on ADD COLUMN (idempotent migration)"
    - "CHECK constraint for order_type valid values"

key-files:
  created:
    - supabase/migrations/035_order_type_delivery_address.sql
    - scripts/apply-migration-035.mjs
  modified:
    - src/types/database.ts
    - src/app/api/orders/route.ts

key-decisions:
  - "TEXT + CHECK constraint instead of ENUM — forward-compatible, no ALTER TYPE needed for new order types"
  - "Default 'dine_in' makes all existing orders backward-compatible without data migration"
  - "delivery_fee_cents fetched from tenant_settings server-side — client supplies only order_type, never the fee amount"

duration: ~5min
completed: 2026-05-19
---

# Phase 39 Plan 01: DB Migration + API + Types Summary

**Migration 035 adds order_type and delivery_address to orders; API POST updated with server-side delivery fee enforcement; Order TypeScript interface extended.**

## Accomplishments

- `supabase/migrations/035_order_type_delivery_address.sql`: `order_type TEXT NOT NULL DEFAULT 'dine_in'` (CHECK constraint) + `delivery_address TEXT`; IF NOT EXISTS guards
- `scripts/apply-migration-035.mjs`: runner script following apply-migration-034 pattern
- `src/types/database.ts`: Order interface extended with `order_type: 'dine_in' | 'pickup' | 'delivery'` and `delivery_address: string | null`
- `src/app/api/orders/route.ts`:
  - `CreateOrderRequest` accepts `order_type?` and `delivery_address?`
  - `VALID_ORDER_TYPES` guard — invalid values fall back to `'dine_in'`
  - Delivery requires address — 400 if missing
  - `delivery_fee_cents` fetched from tenant_settings; added to `orderTotal` server-side
  - `order_type` and `delivery_address` included in orders insert

## Migration application

**NOTE:** Migration 035 must be applied manually — `.env.local` not present in remote environment.
Run `node scripts/apply-migration-035.mjs` locally, or paste migration SQL into Supabase SQL editor.

## Next Phase Readiness

- Plan 02 (CartModal) can now send `order_type` + `delivery_address` in POST body and get correct total
- Plan 03 (OrdersClient) can read `order_type` + `delivery_address` from `select('*, order_items(*)')`
