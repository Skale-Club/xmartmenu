---
phase: "31"
plan: "01"
name: Superadmin Plan Management
type: auto
autonomous: true
wave: "1"
depends_on: ["30"]
requirements: [MON-01, MON-02]
---

# Phase 31 Plan: Superadmin Plan Management

## Objective

Implement the superadmin-facing UI for managing subscription plans and tenant subscription overrides. This completes SEED-009 Phase B.

## Context

Phase 30 established the database schema and seed data:
- `plans` table with 3 seed plans (menu $49, orders $99, payments $179)
- `tenant_subscriptions` table with override support
- Helper function `getTenantPlan(tenantId)` in `src/lib/tenant-plan.ts`
- Types: `Plan`, `EffectivePlan`, `TenantSubscription`

This phase builds the UI for superadmins to manage these resources.

## Key Files

### Existing Files to Reference
- `src/types/database.ts` — Plan, EffectivePlan, TenantSubscription types
- `src/lib/tenant-plan.ts` — getTenantPlan helper
- `src/app/(superadmin)/tenants/TenantsClient.tsx` — Tenant list pattern
- `src/app/(superadmin)/tenants/[id]/TenantDetailClient.tsx` — Tenant detail with tabs pattern
- `src/app/(superadmin)/settings/SettingsClient.tsx` — Settings form pattern

### New Files to Create

1. **`src/app/(superadmin)/plans/page.tsx`** — Plan list page
2. **`src/app/(superadmin)/plans/PlansClient.tsx`** — Plan CRUD UI client component
3. **`src/app/api/superadmin/plans/route.ts`** — GET all plans, POST new plan
4. **`src/app/api/superadmin/plans/[id]/route.ts`** — GET/PUT single plan

### Files to Modify

5. **`src/app/(superadmin)/tenants/[id]/TenantDetailClient.tsx`** — Add subscription tab
6. **`src/app/(superadmin)/tenants/TenantsClient.tsx`** — Add plan column to table

---

## Tasks

### Task 1: Create Plan List Page
**Type:** auto  
**Verification:** Page loads at /superadmin/plans

- Create `src/app/(superadmin)/plans/page.tsx` — Server component that fetches plans via API and renders PlansClient
- Create `src/app/(superadmin)/plans/PlansClient.tsx` — Client component with:
  - List all plans in a table/card layout
  - Inline editing for: name, monthly_price, annual_price, transaction_fee_pct, features, is_active, sort_order
  - Add new plan form (name required, prices default to 0)
  - Activate/deactivate toggle per plan
  - Delete plan (with confirmation dialog) if no tenants assigned or warning if tenants exist

### Task 2: Create Plans API Route
**Type:** auto  
**Verification:** GET /api/superadmin/plans returns all plans

- Create `src/app/api/superadmin/plans/route.ts`:
  - `GET` — Fetch all plans ordered by sort_order
  - `POST` — Create new plan with validation (name required, prices >= 0, annual >= monthly)

- Create `src/app/api/superadmin/plans/[id]/route.ts`:
  - `GET` — Fetch single plan by ID
  - `PUT` — Update plan fields (all editable, supports partial updates)

### Task 3: Add Subscription Tab to Tenant Detail
**Type:** auto  
**Verification:** Subscription tab visible in /superadmin/tenants/[id]

- Modify `src/app/(superadmin)/tenants/[id]/page.tsx` to fetch subscription data via API
- Modify `TenantDetailClient.tsx`:
  - Add `'subscription'` to tabs array
  - Display in subscription tab:
    - Current plan name (read-only)
    - Effective price (with breakdown: base vs override if applied)
    - Billing cycle selector (monthly/annual toggle)
    - Override fields:
      - override_monthly_price (number input, empty = use base)
      - override_annual_price (number input, empty = use base)
      - override_transaction_fee_pct (number input, empty = use base)
      - override_notes (textarea)
    - "Save Override" button with loading state
    - Visual indicator: "Base: $X" vs "Override: $Y"
    - Grandfathered indicator if applicable

- Create `src/app/api/superadmin/tenants/[id]/subscription/route.ts`:
  - `GET` — Fetch tenant subscription with plan
  - `PUT` — Update subscription/override fields

### Task 4: Add Plan Column to Tenant List
**Type:** auto  
**Verification:** Plan column visible in /superadmin/tenants

- Modify `src/app/(superadmin)/tenants/page.tsx` to fetch plan info in tenant data
- Modify `TenantsClient.tsx`:
  - Add "Plan" column after Status (or inline in header row)
  - Show current plan name or "—" if no subscription
  - Use existing plan badge styling (pro=blue, enterprise=purple, free=gray)

---

## Verification Criteria

1. `/superadmin/plans` loads with all plans displayed
2. Can create a new plan via the form
3. Can edit any plan field inline with save
4. Can toggle plan active/inactive
5. `/superadmin/tenants/[id]` shows new Subscription tab
6. Subscription tab displays current plan with effective pricing
7. Can change billing cycle (monthly/annual)
8. Can set price overrides and save
9. `/superadmin/tenants` shows plan column for each tenant

---

## Output Specification

- **Created files:** 4 new files
- **Modified files:** 3 existing files
- **Commits:** One commit per task (6 total)
- **SUMMARY:** Phase 31 execution summary with deviations document