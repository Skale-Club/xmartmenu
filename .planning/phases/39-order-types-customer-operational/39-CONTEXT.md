---
phase: 39-order-types-customer-operational
depends_on: 38
requirements: [ORD-04, ORD-05, ORD-06, ORD-07]
---

# Phase 39 Context: Order Types — Customer & Operational

## What Phase 38 built

Migration 034 added 5 columns to `tenant_settings`:
- `dine_in_enabled BOOLEAN DEFAULT true`
- `pickup_enabled BOOLEAN DEFAULT false`
- `delivery_enabled BOOLEAN DEFAULT false`
- `pickup_eta_minutes INT DEFAULT 20`
- `delivery_fee_cents INT DEFAULT 0`

StoreClient.tsx now has a toggleable UI for admins to configure these.

The orders table does NOT yet have `order_type` or `delivery_address` columns.

## What Phase 39 must add

### DB (Plan 01)
- Migration 035: `order_type TEXT NOT NULL DEFAULT 'dine_in'` and `delivery_address TEXT` on orders table

### API (Plan 01)
- POST /api/orders: accept `order_type` + `delivery_address`, server-side add delivery fee to total by reading tenant_settings, validate delivery_address present when delivery mode

### Customer UI (Plan 02)
- CartModal: order type selector chips when 2+ modes active; delivery address input; delivery fee line in totals
- MenuPage: state for orderType + deliveryAddress, pass config to CartModal, include in POST body

### Admin/KDS UI (Plan 03)
- OrderCard: fulfillment badge (Dine-In / Pick-Up / Delivery)
- OrdersClient: order type filter chips (All / Dine-In / Pick-Up / Delivery)

## Key files

| File | Role |
|------|------|
| `src/app/api/orders/route.ts` | POST creates order (lines 63–165), GET fetches for admin (168–197) |
| `src/components/menu/CartModal.tsx` | Customer cart + order submission UI |
| `src/components/menu/MenuPage.tsx` | Owns submitOrder, cart state, settings |
| `src/app/(admin)/orders/OrdersClient.tsx` | Orders list + KDS grid + OrderCard |
| `src/app/(admin)/orders/page.tsx` | SSR fetch of orders + thresholds |
| `src/types/database.ts` | Order interface (lines ~221-232) |

## Architecture decisions

- **Server-side fee enforcement:** delivery_fee_cents is fetched from tenant_settings in the API — client cannot supply or spoof the fee
- **order_type default 'dine_in':** backward-compatible for all existing orders
- **Selector hidden when only dine_in active:** no UI noise for restaurants that haven't enabled pick-up/delivery
- **OrderCard badge is additive:** no existing card UI changes; badge appears as a new chip row
- **deliveryAddress in form state lives in MenuPage** (not CartModal) — MenuPage owns submitOrder and needs the value

## Current CartModal props interface

```typescript
CartModal({
  cart, confirmedCart, currency,
  customerName, customerPhone,
  submittingOrder, orderSuccess, orderError, orderId,
  ui, accentColor,
  onClose, onCustomerNameChange, onCustomerPhoneChange,
  onRemove, onUpdateQuantity,
  onSubmit: () => void
})
```

New props to add:
```typescript
  orderTypeConfig: { dineIn: boolean; pickup: boolean; delivery: boolean; deliveryFeeCents: number }
  orderType: string
  deliveryAddress: string
  onOrderTypeChange: (t: string) => void
  onDeliveryAddressChange: (a: string) => void
```

## MenuPage settings access

`const settings = tenant.tenant_settings` — already in scope (line 88).
Fields `dine_in_enabled`, `pickup_enabled`, `delivery_enabled`, `delivery_fee_cents` are on TenantSettings
after Phase 38 / migration 034.

## Order interface gaps (database.ts lines ~221-232)

Missing fields:
- `order_type: 'dine_in' | 'pickup' | 'delivery'`
- `delivery_address: string | null`

## OrdersClient local types

OrdersClient.tsx has its own extended Order interface (includes `order_items`) — check the top of the file.
After Plan 01 adds the DB columns, the `select('*, order_items(*)')` in both page.tsx and GET route
will automatically return `order_type` and `delivery_address`.
