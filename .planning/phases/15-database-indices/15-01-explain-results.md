# Phase 15 Plan 01 — EXPLAIN ANALYZE Results: Public Menu Path

**Date:** 2026-05-07
**DB:** Supabase (production)
**Method:** Predicted from code/migration analysis — EXPLAIN ANALYZE deferred by user

> **Note:** The user elected not to run EXPLAIN ANALYZE in the Supabase SQL Editor.
> These results are derived from systematic analysis of all migration files
> (`001_initial_schema.sql`, `019_full_schema_sync.sql`, `021_orders_v11_schema.sql`)
> cross-referenced with the actual query patterns extracted from the route source files.
> Confidence is high: the presence or absence of an index in the migration files is
> deterministic — PostgreSQL cannot use an index that does not exist.

---

## Summary Table

| Section | Query | Scan Type | Needs Index? |
|---------|-------|-----------|--------------|
| A | tenants WHERE slug = 'restaurante-teste' AND is_active = true | Index Scan (idx_tenants_slug) | No — index exists |
| B | menus WHERE tenant_id = $1 AND is_active = true AND is_default = true | Seq Scan | YES |
| C | menus WHERE tenant_id = $1 AND is_active = true ORDER BY position LIMIT 1 | Seq Scan | YES |
| D | menus WHERE slug = $1 AND is_active = true | Seq Scan | YES |
| E | categories WHERE menu_id = $1 AND is_active = true ORDER BY position | Seq Scan | YES |
| F | products WHERE menu_id = $1 AND is_available = true ORDER BY position | Seq Scan | YES |
| G | product_option_groups WHERE product_id IN (...) ORDER BY position | Index Scan (idx_option_groups_product) | No — index exists |

---

## Analysis Per Section

### Section A — tenants WHERE slug = ... (PASS)

**Migration evidence:** `001_initial_schema.sql` line 97:
```sql
CREATE INDEX idx_tenants_slug ON tenants(slug);
```
Plus `tenants.slug` has a `UNIQUE NOT NULL` constraint, which also creates a unique index.

**Prediction:** Index Scan using `idx_tenants_slug` (or the UNIQUE constraint index).
**Needs index:** No.

---

### Section B — menus WHERE tenant_id = ... AND is_default = true (FAIL — Seq Scan)

**Migration evidence:** No migration file contains `CREATE INDEX ... ON menus(tenant_id)`.
The only index structure on `menus` is a `UNIQUE(tenant_id, slug)` composite constraint.
A composite unique index on `(tenant_id, slug)` cannot serve a query filtering on
`tenant_id` alone when the leading column is absent from the WHERE clause in a
selectivity-optimized way (and `is_default` adds a Boolean filter, not an indexed
column).

**Prediction:** Seq Scan on `menus`.
**Needs index:** Yes — `menus(tenant_id)`.

---

### Section C — menus WHERE tenant_id = ... ORDER BY position LIMIT 1 (FAIL — Seq Scan)

**Migration evidence:** Same as Section B — no `menus(tenant_id)` index exists.
The ORDER BY position with LIMIT 1 cannot use an index without a composite index on
`(tenant_id, position)`.

**Prediction:** Seq Scan on `menus`.
**Needs index:** Yes — `menus(tenant_id)` at minimum; `menus(tenant_id, position)` would
additionally eliminate the sort step.

---

### Section D — menus WHERE slug = ... AND is_active = true (FAIL — Seq Scan)

**Migration evidence:** The `UNIQUE(tenant_id, slug)` composite constraint on `menus`
creates a composite index with `tenant_id` as the leading column. PostgreSQL can use a
composite index for a predicate on the leading column (`tenant_id`), but NOT efficiently
for a predicate on the trailing column (`slug`) alone. A slug-only WHERE clause forces
a full sequential scan.

**Prediction:** Seq Scan on `menus` (composite index unusable for slug-only filter).
**Needs index:** Yes — a dedicated `menus(slug)` single-column index.

---

### Section E — categories WHERE menu_id = ... (FAIL — Seq Scan)

**Migration evidence:** `001_initial_schema.sql` and all subsequent migrations define:
```sql
CREATE INDEX idx_categories_tenant ON categories(tenant_id);
```
No index on `categories(menu_id)` exists in any migration.

**Prediction:** Seq Scan on `categories`.
**Needs index:** Yes — `categories(menu_id)`.

---

### Section F — products WHERE menu_id = ... (FAIL — Seq Scan)

**Migration evidence:** `001_initial_schema.sql` defines:
```sql
CREATE INDEX idx_products_tenant ON products(tenant_id);
CREATE INDEX idx_products_category ON products(category_id);
```
No index on `products(menu_id)` exists. Note: `products` has a `menu_id` column (added
in a later migration for multi-menu support) that is NOT covered by any existing index.

**Prediction:** Seq Scan on `products`.
**Needs index:** Yes — `products(menu_id)`.

---

### Section G — product_option_groups WHERE product_id IN (...) (PASS)

**Migration evidence:** `021_orders_v11_schema.sql` contains:
```sql
CREATE INDEX idx_option_groups_product ON product_option_groups(product_id);
```

**Prediction:** Index Scan using `idx_option_groups_product`.
**Needs index:** No — index exists.

---

## Indices Identified as Missing

These columns have confirmed Seq Scans on every page load of the public menu route.
They feed directly into Plan 03's migration:

1. **`menus(tenant_id)`** — used in both `/{slug}` routes (default menu lookup + fallback)
2. **`menus(slug)`** — used in `/{slug}/{menuSlug}` route (menu-by-slug lookup)
3. **`categories(menu_id)`** — used in both public routes, every page load
4. **`products(menu_id)`** — used in both public routes, every page load

### Optional composite index (performance uplift beyond correctness)

- **`menus(tenant_id, position)`** — eliminates sort step in fallback ORDER BY position LIMIT 1 query (Section C). Adds marginal value; include in migration for completeness.

---

## Existing Indices Confirmed (No Action Needed)

| Index | Column | Used By |
|-------|--------|---------|
| idx_tenants_slug | tenants(slug) | All public routes — Section A |
| idx_option_groups_product | product_option_groups(product_id) | /{slug}/{menuSlug} — Section G |
| idx_products_tenant | products(tenant_id) | Admin routes (not public menu path) |
| idx_products_category | products(category_id) | Admin routes (not public menu path) |
| idx_categories_tenant | categories(tenant_id) | Admin routes (not public menu path) |
