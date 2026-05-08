---
phase: 23
plan: "01"
subsystem: database
tags: [migration, typescript, ingredients, rls, schema]
dependency_graph:
  requires: [migration-025]
  provides: [ingredients-table, product-ingredients-table, ingredient-customization-flag, ingredient-modifications-column]
  affects: [tenant-settings, order-items, typescript-types]
tech_stack:
  added: []
  patterns: [IF-NOT-EXISTS idempotent migration, DO-$-policy guards, RLS tenant-scoped]
key_files:
  created:
    - supabase/migrations/026_ingredient_schema.sql
  modified:
    - src/types/database.ts
decisions:
  - "Public read policy on product_ingredients uses USING(true) — customers need all product ingredients for the customization panel, not just available ones; availability filtering happens at the ingredient level"
  - "Primary key on product_ingredients is composite (product_id, ingredient_id) — satisfies UNIQUE constraint without a separate index"
  - "IngredientModifications typed as interface (not type alias) — consistent with existing type patterns in database.ts"
  - "added field in IngredientModifications reuses IngredientExtra type — both additions and extras carry the same payload (qty + unit_price)"
metrics:
  duration: 98s
  completed: 2026-05-08
  tasks_completed: 2
  files_created: 1
  files_modified: 1
requirements: [INGR-01, INGR-02, INGR-03, INGR-04]
---

# Phase 23 Plan 01: Ingredient Schema Summary

## One-liner

Idempotent SQL migration 026 creating normalized `ingredients` catalog + `product_ingredients` join table with RLS, plus TypeScript types for all 4 ingredient schema requirements.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Migration 026 — ingredient schema | 04f2529 | supabase/migrations/026_ingredient_schema.sql |
| 2 | TypeScript types for ingredient entities | f6baeea | src/types/database.ts |

## What Was Built

### Migration 026 (`supabase/migrations/026_ingredient_schema.sql`)

Four schema changes, all idempotent with `IF NOT EXISTS` guards:

1. **`ingredients` table** (INGR-01) — normalized ingredient catalog per tenant with RLS:
   - Two policies: `"Tenant members manage ingredients"` (all ops via `auth_tenant_id()`) + `"Public read available ingredients"` (SELECT where `is_available=true`)
   - Index: `idx_ingredients_tenant ON ingredients(tenant_id)`
   - `updated_at` trigger wired to existing `update_updated_at()` function

2. **`product_ingredients` join table** (INGR-02) — links products to ingredients with per-product price overrides:
   - `PRIMARY KEY (product_id, ingredient_id)` satisfies the UNIQUE constraint
   - Two policies: `"Tenant members manage product_ingredients"` + `"Public read product_ingredients"` (SELECT for customization panel)
   - Index: `idx_product_ingredients_product_tenant ON product_ingredients(product_id, tenant_id)`

3. **`tenant_settings.ingredient_customization_enabled`** (INGR-03) — `BOOLEAN NOT NULL DEFAULT false` via `ADD COLUMN IF NOT EXISTS`

4. **`order_items.ingredient_modifications`** (INGR-04) — `JSONB` (nullable, no default) via `ADD COLUMN IF NOT EXISTS`

### TypeScript Types (`src/types/database.ts`)

Additive-only changes to existing file:

- `Ingredient` interface — full catalog fields matching DB columns
- `ProductIngredient` interface — join table fields with nullable override prices
- `ProductIngredientWithIngredient` joined type — extends `ProductIngredient` with `ingredient: Ingredient`
- `IngredientRemoval` interface — `{ingredient_id, name}` for removal entries
- `IngredientExtra` interface — `{ingredient_id, name, qty, unit_price}` for extras/additions
- `IngredientModifications` interface — `{removed: IngredientRemoval[], extras: IngredientExtra[], added: IngredientExtra[]}`
- `TenantSettings.ingredient_customization_enabled: boolean` field added
- `OrderItem.ingredient_modifications: IngredientModifications | null` field added

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — this plan delivers pure schema/types with no UI components.

## Verification Results

- [x] `supabase/migrations/026_ingredient_schema.sql` exists
- [x] `ingredients` table defined with all required columns
- [x] `product_ingredients` table defined with `PRIMARY KEY (product_id, ingredient_id)` constraint
- [x] `idx_product_ingredients_product_tenant` index present
- [x] `tenant_settings.ingredient_customization_enabled` ALTER TABLE present
- [x] `order_items.ingredient_modifications` ALTER TABLE present
- [x] All policies wrapped in `DO $$ IF NOT EXISTS` blocks (idempotent)
- [x] `Ingredient` interface in database.ts
- [x] `ProductIngredient` interface in database.ts
- [x] `IngredientModifications` + sub-types in database.ts
- [x] `TenantSettings.ingredient_customization_enabled` field present
- [x] `OrderItem.ingredient_modifications` field present

## Self-Check: PASSED

All files exist and all commits verified.
