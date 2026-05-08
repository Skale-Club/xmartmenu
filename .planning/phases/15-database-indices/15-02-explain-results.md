# 15-02 EXPLAIN ANALYZE Results

**Method:** Predicted from code and migration analysis — EXPLAIN ANALYZE deferred by user.

EXPLAIN ANALYZE against live Supabase was not executed. The user confirmed that code/migration
analysis is sufficient to establish index coverage for this phase. All findings below are derived
from inspection of migration files (especially `019_full_schema_sync.sql`) and the existing index
declarations in the schema.

---

## Query Analysis

### Section A — Tenant Settings JOIN

**Query pattern:** `tenants JOIN tenant_settings WHERE tenants.id = $1`

**Index coverage:**
- `tenants(id)` — covered by primary key (`tenants_pkey`)
- `tenant_settings(tenant_id)` — covered by UNIQUE constraint on `tenant_id` (unique constraint
  creates a B-tree index in PostgreSQL)

**Predicted plan:** Index Scan on `tenants_pkey` + Index Scan/Unique Scan on `tenant_settings`
unique index.

**Status:** No missing indices. No action required.

---

### Section B — Orders List (tenant-filtered, ordered by created_at)

**Query pattern:** `SELECT * FROM orders WHERE tenant_id = $1 ORDER BY created_at DESC`

**Index coverage:**
- `idx_orders_tenant ON orders(tenant_id)` — created in migration 019, line 155
- `idx_orders_created_at ON orders(created_at)` — created in migration 019, line 156

**Predicted plan:** Index Scan on `idx_orders_tenant` for the WHERE clause. The ORDER BY may
trigger a sort or use `idx_orders_created_at` depending on selectivity. At current data volumes
no Seq Scan concern exists.

**Status:** No missing indices. Both relevant indices exist.

---

### Section C — Profile by Primary Key

**Query pattern:** `SELECT * FROM profiles WHERE id = $1`

**Index coverage:**
- `profiles_pkey` (UUID primary key)

**Predicted plan:** Index Scan on `profiles_pkey`.

**Status:** No missing indices.

---

### Section D — Profile with Role Filter (RLS / auth middleware)

**Query pattern:** `SELECT * FROM profiles WHERE id = $1 AND role IN (...)`

**Index coverage:**
- Lookup by `id` uses `profiles_pkey`.
- `role` is not separately indexed; filter is applied after the PK lookup (single-row result set).

**Predicted plan:** Index Scan on `profiles_pkey` → single row → filter on `role` in memory.

**Status:** No missing indices. Adding a composite index on `(id, role)` would be micro-optimising
a single-row PK fetch and is not warranted.

---

### Section E — Orders INSERT

**Query pattern:** `INSERT INTO orders (...) VALUES (...)`

**Index coverage:** INSERTs do not use read indices for the write path. The write touches
`idx_orders_tenant` and `idx_orders_created_at` (index maintenance), which is normal overhead.

**Predicted plan:** `ModifyTable` node. No Seq Scan possible for INSERT.

**Status:** No action required.

---

### Section F — Tenant Settings by Tenant ID (read path)

**Query pattern:** `SELECT * FROM tenant_settings WHERE tenant_id = $1`

**Index coverage:**
- UNIQUE constraint on `tenant_id` in `tenant_settings` acts as a B-tree index in PostgreSQL.

**Predicted plan:** Index Scan using the unique-constraint index.

**Status:** No missing indices.

---

## Summary

| Section | Query | Predicted Node | Index Used | Gap |
|---------|-------|----------------|------------|-----|
| A | tenants JOIN tenant_settings | Index Scan | tenants_pkey + tenant_settings UNIQUE | None |
| B | orders WHERE tenant_id ORDER BY created_at | Index Scan | idx_orders_tenant, idx_orders_created_at | None |
| C | profiles WHERE id | Index Scan | profiles_pkey | None |
| D | profiles WHERE id AND role | Index Scan + mem filter | profiles_pkey | None |
| E | INSERT INTO orders | ModifyTable | n/a | None |
| F | tenant_settings WHERE tenant_id | Index Scan | UNIQUE constraint index | None |

**Conclusion:** All critical query paths use PK lookups or existing named indices. No new indices
are required at this stage. The orders and auth paths have no missing indices that would cause
unacceptable Seq Scans under current or projected row counts.

---

## Indices Confirmed Present (from migrations)

From `supabase/migrations/019_full_schema_sync.sql`:

```sql
CREATE INDEX IF NOT EXISTS idx_orders_tenant     ON orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_order_items_order  ON order_items(order_id);
```

Additional implicit indices from PK and UNIQUE constraints:
- `tenants_pkey` on `tenants(id)`
- `profiles_pkey` on `profiles(id)`
- `tenant_settings` UNIQUE on `tenant_id`
- `menus` UNIQUE on `(tenant_id, slug)`
- `orders_pkey` on `orders(id)`

---

*Analysis method: static — migration and code review only*
*EXPLAIN ANALYZE execution: deferred by user (not run against production)*
*Date: 2026-05-07*
