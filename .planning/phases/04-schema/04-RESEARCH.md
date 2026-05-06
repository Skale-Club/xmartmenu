# Phase 4: Schema - Research

**Researched:** 2026-05-06
**Domain:** Supabase PostgreSQL migrations, RLS policies, TypeScript database types
**Confidence:** HIGH

## Summary

Phase 4 creates the database foundation for the v1.1 Orders feature. Two new tables are needed (`product_option_groups`, `product_options`) and two existing tables (`orders`, `order_items`) require ALTER migrations to match the v1.1 specification. The TypeScript types in `src/types/database.ts` must be extended with all four new/updated table interfaces.

The project already has 19 migrations and a battle-tested pattern for idempotent SQL: `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `DO $$ BEGIN ... END $$` guards for policies. Every new migration MUST follow this same pattern so it can be re-run safely in the Supabase SQL Editor.

The critical risk in this phase is the existing `orders` and `order_items` tables in production (migration 019) diverge from the v1.1 spec in three concrete ways: wrong status enum values, missing `notes` column on `orders`, and missing `selected_options JSONB` column on `order_items`. The plan must include ALTER statements for these existing tables, not just CREATE for the new ones. Additionally the existing `orders_public_insert` RLS policy uses `WITH CHECK (true)` but ORD-03 requires it be gated on `orders_enabled=true`.

**Primary recommendation:** Write a single migration file `020_orders_v11_schema.sql` that (1) ALTERs existing `orders`/`order_items` to v1.1 spec, (2) CREATEs `product_option_groups` and `product_options`, (3) replaces the public-insert RLS policy with the orders_enabled check, and (4) adds indices. Then extend `src/types/database.ts` with all four updated/new interfaces.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ORD-01 | `product_option_groups` table: id, product_id, tenant_id, name, type (single/multiple/half_and_half), required, min_selections, max_selections, price_rule (max/average/sum/fixed), position, translations JSONB | New table — fully documented in Architecture Patterns |
| ORD-02 | `product_options` table: id, group_id, tenant_id, name, base_price (nullable), price_modifier, is_available, position, translations JSONB | New table — references product_option_groups |
| ORD-03 | `orders` table updated: status enum (pending/preparing/ready/done/cancelled), add notes field; RLS: tenant admin read/write own orders; public insert only if orders_enabled=true | ALTER existing table — status constraint change + column add + RLS policy replacement |
| ORD-04 | `order_items` table updated: add selected_options JSONB; unit_price stores final resolved price | ALTER existing table — column add |
</phase_requirements>

## Gap Analysis: Existing vs. Required

This is the most important section for planning. The production schema (migration 019) and v1.1 spec diverge in these specific ways:

### Tables that NEED ALTERING (exist in DB, wrong structure)

**`orders` table (ORD-03):**

| Column / Constraint | Current (migration 019) | Required (ORD-03) | Action |
|---------------------|-------------------------|-------------------|--------|
| `status` CHECK | `('pending','confirmed','completed','cancelled')` | `('pending','preparing','ready','done','cancelled')` | DROP old constraint, ADD new constraint |
| `notes` column | MISSING | `TEXT` (nullable) | `ADD COLUMN IF NOT EXISTS` |

**`order_items` table (ORD-04):**

| Column | Current (migration 019) | Required (ORD-04) | Action |
|--------|-------------------------|-------------------|--------|
| `selected_options` | MISSING | `JSONB` (nullable) | `ADD COLUMN IF NOT EXISTS` |

**`orders` RLS policy `orders_public_insert` (ORD-03):**

| Current | Required |
|---------|----------|
| `WITH CHECK (true)` — allows public insert always | `WITH CHECK (EXISTS (SELECT 1 FROM tenant_settings WHERE tenant_id = orders.tenant_id AND orders_enabled = true))` |

### Tables that NEED CREATING (do not exist)

- `product_option_groups` (ORD-01)
- `product_options` (ORD-02)

### TypeScript types that NEED UPDATING (src/types/database.ts)

| Type | Current | Required Change |
|------|---------|-----------------|
| `Order.status` | `'pending' \| 'confirmed' \| 'completed' \| 'cancelled'` | `'pending' \| 'preparing' \| 'ready' \| 'done' \| 'cancelled'` |
| `Order` | Missing `notes` field | Add `notes: string \| null` |
| `OrderItem` | Missing `selected_options` | Add `selected_options: Record<string, unknown> \| null` |
| `ProductOptionGroup` | Does not exist | New interface |
| `ProductOption` | Does not exist | New interface |

## Standard Stack

### Core (all already in project)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Supabase (PostgreSQL) | managed | Database + RLS | Project-wide choice, all 19 migrations use it |
| `@supabase/supabase-js` | `^2.101.1` | DB client | Already installed |
| TypeScript | `^5` | Type safety | Project language |

### No new packages required
This phase is pure SQL migration + TypeScript type editing. Zero new npm dependencies.

## Architecture Patterns

### Migration File Conventions (from existing migrations)

All 19 existing migrations follow these rules — the new migration MUST too:

1. **Filename:** `supabase/migrations/020_orders_v11_schema.sql`
2. **Idempotent guards everywhere** — every statement must be safe to re-run:
   - Tables: `CREATE TABLE IF NOT EXISTS`
   - Columns: `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
   - Policies: `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE ...) THEN ... END IF; END $$`
   - Constraints: drop before adding (`ALTER TABLE x DROP CONSTRAINT IF EXISTS y; ALTER TABLE x ADD CONSTRAINT y CHECK (...)`)
   - Indices: `CREATE INDEX IF NOT EXISTS`
3. **Section headers:** Use the `-- ===... -- N. TABLE NAME` comment blocks for readability
4. **RLS always enabled:** `ALTER TABLE x ENABLE ROW LEVEL SECURITY` immediately after CREATE TABLE
5. **updated_at trigger:** Use the existing `update_updated_at()` function (already defined in migration 001)
6. **Helper functions available:** `auth_tenant_id()` and `is_superadmin()` exist from migration 001 — use them directly

### Recommended Project Structure (no changes needed)
```
supabase/
  migrations/
    020_orders_v11_schema.sql    ← new file this phase
src/
  types/
    database.ts                  ← extend with new/updated interfaces
```

### Pattern 1: ALTER existing table with new column
```sql
-- Source: project convention (migrations 006, 011, etc.)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS selected_options JSONB;
```

### Pattern 2: DROP + recreate CHECK constraint
PostgreSQL does not support `ALTER CONSTRAINT` for CHECK constraints. The only safe path is:
```sql
-- Source: migration 019 (used same pattern for profiles_role_check)
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('pending', 'preparing', 'ready', 'done', 'cancelled'));
```
**Important:** Existing rows with status `'confirmed'` or `'completed'` will FAIL this new constraint. The plan must include an UPDATE to migrate any such rows before adding the constraint:
```sql
UPDATE orders SET status = 'preparing' WHERE status = 'confirmed';
UPDATE orders SET status = 'done'      WHERE status = 'completed';
```

### Pattern 3: Drop + recreate RLS policy (ORD-03 orders_enabled gate)
```sql
-- Source: project convention (migration 019 uses same DO-block pattern)
DROP POLICY IF EXISTS "orders_public_insert" ON orders;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'orders' AND policyname = 'orders_public_insert'
  ) THEN
    CREATE POLICY "orders_public_insert" ON orders FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM tenant_settings ts
          WHERE ts.tenant_id = orders.tenant_id
            AND ts.orders_enabled = true
        )
      );
  END IF;
END $$;
```

### Pattern 4: New table with RLS (ORD-01 / ORD-02)
```sql
-- Source: migration 019 (menus table pattern)
CREATE TABLE IF NOT EXISTS product_option_groups (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id       UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  type             TEXT NOT NULL DEFAULT 'single'
                     CHECK (type IN ('single', 'multiple', 'half_and_half')),
  required         BOOLEAN NOT NULL DEFAULT false,
  min_selections   INTEGER NOT NULL DEFAULT 0,
  max_selections   INTEGER,
  price_rule       TEXT NOT NULL DEFAULT 'sum'
                     CHECK (price_rule IN ('max', 'average', 'sum', 'fixed')),
  position         INTEGER NOT NULL DEFAULT 0,
  translations     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE product_option_groups ENABLE ROW LEVEL SECURITY;

-- Admin: manage own groups; superadmin: manage all
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'product_option_groups' AND policyname = 'option_groups_admin'
  ) THEN
    CREATE POLICY "option_groups_admin" ON product_option_groups FOR ALL
      USING (tenant_id = auth_tenant_id() OR is_superadmin());
  END IF;
END $$;

-- Public: read option groups (needed to display options on menu)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'product_option_groups' AND policyname = 'option_groups_public_read'
  ) THEN
    CREATE POLICY "option_groups_public_read" ON product_option_groups FOR SELECT
      USING (true);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS product_options (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        UUID NOT NULL REFERENCES product_option_groups(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  base_price      NUMERIC(10,2),
  price_modifier  NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_available    BOOLEAN NOT NULL DEFAULT true,
  position        INTEGER NOT NULL DEFAULT 0,
  translations    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE product_options ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'product_options' AND policyname = 'options_admin'
  ) THEN
    CREATE POLICY "options_admin" ON product_options FOR ALL
      USING (tenant_id = auth_tenant_id() OR is_superadmin());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'product_options' AND policyname = 'options_public_read'
  ) THEN
    CREATE POLICY "options_public_read" ON product_options FOR SELECT
      USING (true);
  END IF;
END $$;
```

### Pattern 5: TypeScript interface additions (database.ts)

Project convention (from existing types): use `interface`, `string` for UUIDs/timestamps, `number` for NUMERIC, `Record<string,unknown>` for free-form JSONB, specific union types for enums.

```typescript
// Source: src/types/database.ts existing pattern

// UPDATE Order (change status union + add notes)
export interface Order {
  id: string
  tenant_id: string
  customer_name: string
  customer_phone: string
  status: 'pending' | 'preparing' | 'ready' | 'done' | 'cancelled'  // changed
  total: number
  notes: string | null                                                 // new
  created_at: string
  updated_at: string
}

// UPDATE OrderItem (add selected_options)
export interface OrderItem {
  id: string
  order_id: string
  product_id: string
  product_name: string
  quantity: number
  unit_price: number
  selected_options: Record<string, unknown> | null                     // new
  notes: string | null
}

// NEW ProductOptionGroup
export type OptionGroupType = 'single' | 'multiple' | 'half_and_half'
export type PriceRule = 'max' | 'average' | 'sum' | 'fixed'

export interface ProductOptionGroup {
  id: string
  product_id: string
  tenant_id: string
  name: string
  type: OptionGroupType
  required: boolean
  min_selections: number
  max_selections: number | null
  price_rule: PriceRule
  position: number
  translations: Record<string, { name?: string }>
  created_at: string
  updated_at: string
}

// NEW ProductOption
export interface ProductOption {
  id: string
  group_id: string
  tenant_id: string
  name: string
  base_price: number | null
  price_modifier: number
  is_available: boolean
  position: number
  translations: Record<string, { name?: string }>
  created_at: string
  updated_at: string
}
```

### Anti-Patterns to Avoid

- **Using `WITH CHECK (true)` for public order inserts:** Leaves ordering open even when tenant has disabled it. Must check `orders_enabled` in the RLS policy itself (not just in API code), for defense-in-depth.
- **Forgetting to migrate existing `status` values before changing the CHECK constraint:** ALTER will fail at the constraint-add step if rows have `'confirmed'` or `'completed'` status values.
- **Skipping idempotency guards on policies:** The project's pattern uses `DO $$ BEGIN IF NOT EXISTS ... END $$` blocks. Omitting them causes the migration to fail on re-run.
- **Dropping existing `orders_public_insert` without a `DROP POLICY IF EXISTS` guard:** Migration fails if policy doesn't exist.
- **Setting `translations` columns as nullable:** Existing project pattern uses `NOT NULL DEFAULT '{}'::jsonb` for all translation JSONB columns. Follow the same pattern.
- **Forgetting `updated_at` triggers** for new tables: `product_option_groups` and `product_options` have `updated_at` columns that need a trigger using the existing `update_updated_at()` function.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Idempotent migration | Custom one-time script | SQL `IF NOT EXISTS` + `DO $$ BEGIN` guards | Project convention, safe re-run in SQL Editor |
| Status enum | `CREATE TYPE` PostgreSQL enum | TEXT + CHECK constraint | All existing status fields use CHECK pattern (see `orders` in 019, `plan` in 001) — enums are harder to alter |
| Tenant isolation | Custom middleware check | RLS `auth_tenant_id()` helper | Function already exists, battle-tested |
| Superadmin bypass | Separate policy | `OR is_superadmin()` in existing policy | Pattern used consistently across all tables |

**Key insight:** PostgreSQL `CREATE TYPE` enums require `ALTER TYPE ... ADD VALUE` to extend — which is DDL and transactional in Postgres 12+. The project deliberately uses `TEXT + CHECK` for all enumerated fields. Follow this pattern for `type`, `price_rule`, and `status`.

## Common Pitfalls

### Pitfall 1: Status constraint conflict with existing rows
**What goes wrong:** `ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('pending', 'preparing', 'ready', 'done', 'cancelled'))` fails because existing rows may have `status = 'confirmed'` or `status = 'completed'`.
**Why it happens:** PostgreSQL validates the CHECK constraint against all existing rows when you add it.
**How to avoid:** Always UPDATE existing rows to map old values to new values BEFORE adding the new constraint. Specifically: `UPDATE orders SET status = 'preparing' WHERE status = 'confirmed'` and `UPDATE orders SET status = 'done' WHERE status = 'completed'`.
**Warning signs:** `ERROR: check constraint "orders_status_check" of relation "orders" is violated by some row` in migration output.

### Pitfall 2: RLS policy allows public insert without orders_enabled check
**What goes wrong:** The existing `orders_public_insert` policy uses `WITH CHECK (true)`. This means any anonymous user can insert an order for any tenant, regardless of whether the tenant has orders enabled.
**Why it happens:** Migration 019 was written before the orders_enabled requirement existed.
**How to avoid:** This migration MUST drop the old policy and replace it with one that checks `orders_enabled = true` in `tenant_settings`. The API already validates this, but RLS is the defense-in-depth layer.
**Warning signs:** The orders API route (`src/app/api/orders/route.ts`) validates `orders_enabled` in application code — if the RLS policy is not updated, a direct database call bypasses this check.

### Pitfall 3: Updated_at triggers missing for new tables
**What goes wrong:** `product_option_groups.updated_at` and `product_options.updated_at` columns never auto-update on row changes.
**Why it happens:** Forgetting to create a trigger after creating a new table with an `updated_at` column.
**How to avoid:** After each `CREATE TABLE`, add a `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = '...')` block that creates the trigger using `update_updated_at()`.

### Pitfall 4: `base_price` vs `price_modifier` semantics
**What goes wrong:** Confusing the two price fields on `product_options`. Using the wrong one in the half-and-half price calculation later.
**Why it happens:** The design has two distinct concepts: `base_price` (the absolute price of an option, e.g., a pizza size — nullable because not all options replace the product price) and `price_modifier` (add-on delta, e.g., extra topping +R$2.00 — always present, defaults to 0).
**How to avoid:** `base_price NUMERIC(10,2)` — nullable, used for size/half_and_half options where the option IS the price. `price_modifier NUMERIC(10,2) NOT NULL DEFAULT 0` — used for all options as an additive delta. The half-and-half rule `max(half1.base_price, half2.base_price)` depends on `base_price` being set for those option types.

### Pitfall 5: TypeScript `status` union out of sync with DB constraint
**What goes wrong:** `npm run build` fails or runtime type errors occur because the TypeScript `Order.status` union still includes old values (`'confirmed'`, `'completed'`) or is missing new ones (`'preparing'`, `'ready'`, `'done'`).
**Why it happens:** The DB constraint is changed but `src/types/database.ts` is not updated.
**How to avoid:** The plan must include a specific task to update `Order.status` union in `database.ts` immediately after the migration task.

## State of the Art

| Old Approach (migration 019) | Updated Approach (this phase) | Impact |
|------------------------------|-------------------------------|--------|
| `orders.status CHECK ('pending','confirmed','completed','cancelled')` | `CHECK ('pending','preparing','ready','done','cancelled')` | Aligns with kitchen-workflow language (ORD-03) |
| `orders_public_insert WITH CHECK (true)` | `WITH CHECK (orders_enabled = true in tenant_settings)` | Defense-in-depth, closes RLS gap |
| `order_items` — no `selected_options` | `order_items.selected_options JSONB` | Required to persist option selections (ORD-04) |
| No product_option_groups/options tables | Both tables created | Unlocks all option/half-and-half features (ORD-01, ORD-02) |

## Environment Availability

Step 2.6: SKIPPED (no external tools required — this phase is pure SQL migration + TypeScript edits. Supabase is an external managed service but no CLI tooling is needed; migrations are applied via SQL Editor per project convention.)

## Open Questions

1. **The `orders_public_insert` policy replacement**
   - What we know: The current policy has `WITH CHECK (true)` and must be replaced
   - What's unclear: Whether any currently-live tenant depends on the unrestricted insert (test data, integration tests)
   - Recommendation: The plan should include the policy replacement unconditionally — the API already checks `orders_enabled` so the new RLS simply enforces the same rule at the DB layer.

2. **Supabase schema cache reload**
   - What we know: Migration 019 ends with a comment "Reload schema cache: Supabase Dashboard → API → Reload schema"
   - What's unclear: Whether this is needed for the project's production Supabase instance
   - Recommendation: Include a reminder note at the end of the migration file (as a comment) to reload schema cache after applying. Not a plan task, just a comment.

## Sources

### Primary (HIGH confidence)
- Existing migrations `supabase/migrations/001_initial_schema.sql` through `019_full_schema_sync.sql` — directly read
- `src/types/database.ts` — directly read, current type definitions confirmed
- `.planning/REQUIREMENTS.md` — ORD-01 through ORD-04 field lists confirmed
- `src/app/api/orders/route.ts` — existing API code and status values confirmed

### Secondary (MEDIUM confidence)
- PostgreSQL documentation pattern for `ALTER TABLE ... DROP CONSTRAINT IF EXISTS` + re-add — standard DDL practice

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, uses existing project libraries
- Architecture: HIGH — migration patterns derived directly from reading the 19 existing migrations
- Pitfalls: HIGH — gap analysis derived from direct comparison of migration 019 vs ORD-01..04 requirements

**Research date:** 2026-05-06
**Valid until:** 2026-06-06 (stable — Supabase postgres patterns don't change rapidly)
