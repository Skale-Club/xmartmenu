# Phase 38: Order Types — Admin & Schema - Context

**Gathered:** 2026-05-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Add 5 new columns to `tenant_settings` for order type configuration, write migration 034, and build the "Order Types" admin settings section in StoreClient.tsx with toggles, conditional pick-up ETA field, and conditional delivery fee field. Orders table changes (order_type column) belong in Phase 39 — excluded here.

</domain>

<decisions>
## Implementation Decisions

### DB Migration Design
- Add 5 columns to existing `tenant_settings` table (same pattern as all prior boolean flags)
- Defaults: `dine_in_enabled DEFAULT true`, `pickup_enabled DEFAULT false`, `delivery_enabled DEFAULT false`, `pickup_eta_minutes DEFAULT 20`, `delivery_fee_cents DEFAULT 0`
- Migration number: `034` (last applied was `033_profiles_customer_role_and_fk_hardening.sql`)
- `orders.order_type` column is NOT added in this phase — Phase 39 only

### Admin Settings UI
- New "Order Types" section in StoreClient.tsx, below the existing orders/KDS flags section
- Three independent toggle switches: Dine-in (locked on by default but toggleable), Pick-up, Delivery
- Pick-up time field (`pickup_eta_minutes`) shown only when `pickup_enabled` is true (JS conditional)
- Delivery fee field shown only when `delivery_enabled` is true; input accepts dollars (e.g. `2.50`), converted to cents on save (`Math.round(value * 100)`)
- Validation: block save with inline error "At least one order type must be active" if all three are false
- Dine-in toggle note: can be turned off (restaurant may be pick-up or delivery only)

### Plan Structure
- Plan 01: Migration `034` + TypeScript types update in `src/types/database.ts`
- Plan 02: StoreClient.tsx "Order Types" section with toggles + conditional fields + validation
- Migration applied via `node scripts/apply-migration-034.mjs` (same pattern as migrations 025–033)
- No additional feature flag — the toggles themselves are the feature flags; section always visible

### Claude's Discretion
- Exact positioning of the "Order Types" section within StoreClient.tsx relative to existing sections
- Whether to use `<details>` expand/collapse or always-visible layout for the section

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `supabase/migrations/` — migration 033 is the last applied; next is 034
- `src/types/database.ts` — `TenantSettings` interface, lines ~95–115 (where `orders_enabled`, `direct_orders_enabled`, `whatsapp_orders_enabled` live)
- `src/app/(admin)/settings/store/StoreClient.tsx` — existing toggle pattern for `orders_enabled`, `direct_orders_enabled`, `item_notes_enabled` — reuse same pattern
- `scripts/` — `apply-migration-027.mjs` through `apply-migration-033.mjs` exist as reference

### Established Patterns
- Toggle switches in StoreClient use `<input type="checkbox">` or a toggle component with `checked={formState.field}` and `onChange` handlers
- Settings save via PATCH to `/api/admin/settings/store`
- The `pickup_eta_minutes` and `delivery_fee_cents` fields should use the same numeric input pattern as `amber_threshold_minutes`/`red_threshold_minutes` (added in v1.8)

### Integration Points
- `src/app/api/admin/settings/store/route.ts` — PATCH handler needs to accept the 5 new fields
- `src/types/database.ts` TenantSettings interface — add 5 new fields
- Migration 034 — new `IF NOT EXISTS` guard columns on `tenant_settings`

</code_context>

<specifics>
## Specific Ideas

- For the delivery fee, store as integer cents in DB but display as dollar amount with 2 decimal places
- The section header should follow the established pattern: icon + label chip at top-left, section heading
- Pick-up ETA: label "Estimated pick-up time (minutes)", min=1, default=20
- Delivery fee: label "Delivery fee", placeholder "0.00", convert on save

</specifics>

<deferred>
## Deferred Ideas

- orders.order_type column — Phase 39
- KDS badge per order type — Phase 39
- Delivery address field on checkout — Phase 39
- Plan gating for delivery — evaluate post Phase 38

</deferred>
