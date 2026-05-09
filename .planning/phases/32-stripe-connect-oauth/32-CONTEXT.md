---
phase: 32
plan: "01"
name: Stripe Connect OAuth
status: discussion
created: 2026-05-09
---

# Phase 32 Context: Stripe Connect OAuth

## Overview

Phase 32 is the third phase of SEED-009 (v2.0 Monetization). It implements the Stripe Connect OAuth flow for tenants on the `payments` plan, enabling them to connect their own Stripe accounts for receiving customer payments directly.

## What Was Built (Phases 30-31)

### Phase 30: Database Schema
- `plans` table with 3 seed plans (menu $49, orders $99, payments $179)
- `tenant_subscriptions` table with override support
- `stripe_connections` table for per-tenant Stripe account references
- `processed_stripe_events` table for webhook idempotency
- `getTenantPlan()` helper in `src/lib/tenant-plan.ts`

### Phase 31: Superadmin Plan Management
- `/superadmin/plans` — Full CRUD for plans table
- `/superadmin/tenants/[id]` — Subscription tab with override controls
- Tenant list shows plan column

### Key Types Available
```typescript
interface Plan {
  id, name, slug, description, monthly_price, 
  annual_price, transaction_fee_pct, features, 
  is_active, sort_order
}

interface StripeConnection {
  id, tenant_id, stripe_account_id, scope, 
  connected_at, is_active
}

interface EffectivePlan {
  // ... plus billing_cycle, status, is_grandfathered
  features: string[]  // includes 'stripe-connect' for payments plan
}
```

### Feature Gating Rules (from SEED-009)
- `menu` plan → `orders_enabled = false` (forced)
- `orders` plan → `orders_enabled = true`, no Stripe
- `payments` plan → `orders_enabled = true`, Stripe Connect available
- Stripe Connect button visible ONLY in `payments` plan

## What Needs to Be Built (Phase 32)

### 1. OAuth Initiation Route
- `GET /api/stripe/connect/oauth` — Initiates Stripe OAuth flow
- Redirects to Stripe with proper scopes
- Passes `tenant_id` in state parameter
- Requires `STRIPE_CLIENT_ID` env var

### 2. OAuth Callback Route
- `GET /api/stripe/connect/callback` — Handles OAuth callback
- Receives `code` and `state` (tenant_id) from Stripe
- Exchanges code for `stripe_account_id` via `stripe.oauth.token()`
- Saves to `stripe_connections` table
- Redirects to tenant settings with success/error message

### 3. Disconnect Route
- `POST /api/stripe/connect/disconnect` — Deactivates Stripe connection
- Sets `is_active = false` in `stripe_connections`
- Does NOT delete the record (audit trail)
- Returns success status

### 4. Tenant Settings → Subscription Tab Enhancement
- Add "Connect Stripe" button (visible only for `payments` plan)
- Show Stripe connection status:
  - Connected: show `stripe_account_id` (masked), connected date
  - Not connected: show "Connect Stripe" button
- Add "Disconnect" button for connected accounts
- Show feature availability notice for non-payments plans

### 5. Feature Gate Helper
- `stripe_enabled` = tenant is on `payments` plan AND has active `stripe_connections`

## Existing Patterns

### Superadmin Routes
- `/api/superadmin/` — Standard pattern using `createServiceClient()`
- Route handlers with Next.js App Router conventions

### Tenant Settings Pattern
- `src/app/(admin)/settings/store/StoreClient.tsx` — Settings tab pattern
- Section-based form layout
- Tab system for organizing settings

### Environment Variables Needed
```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_CLIENT_ID=ca_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...  # for Phase 33
```

### OAuth Callback Pattern
Stripe Standard OAuth flow:
1. Build authorization URL with `stripe_account_id` param
2. User authorizes on Stripe
3. Stripe redirects to callback with `code`
4. Server exchanges code for `stripe_account_id`
5. Save to database

## Key Files to Create/Modify

### New API Routes
1. `src/app/api/stripe/connect/oauth/route.ts` — OAuth initiation
2. `src/app/api/stripe/connect/callback/route.ts` — OAuth callback
3. `src/app/api/stripe/connect/disconnect/route.ts` — Disconnect

### New Library
4. `src/lib/stripe.ts` — Stripe client initialization

### Modify Tenant Settings
5. `src/app/(admin)/settings/store/StoreClient.tsx` — Add Stripe Connect UI
6. `src/app/(admin)/settings/store/page.tsx` — Fetch Stripe connection data

### Types
7. `src/types/database.ts` — StripeConnection already exists (from Phase 30)

## Requirements from SEED-009

- MON-03: Stripe Connect integration for tenant payments
- MON-04: Feature gating based on plan type
- Stripe Standard OAuth — tenant keeps full Stripe dashboard control
- Money never passes through platform — `transfer_data.destination` to tenant's account
- PCI scope zero — no card data touches our servers

## Key Decisions to Make During Planning

1. **OAuth state parameter:** How to securely pass `tenant_id` through OAuth flow?
2. **Callback redirect:** Where to send user after successful/failed OAuth?
3. **Error handling:** How to surface Stripe errors to tenant?
4. **Disconnect flow:** Soft delete vs hard delete of connection record?
5. **URL construction:** How to build Stripe OAuth URL with proper parameters?