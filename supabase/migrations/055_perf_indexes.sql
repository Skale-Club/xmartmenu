-- 055_perf_indexes.sql
-- Hot-path indexes for the KDS and analytics queries.
--
-- Before this migration scan_events had only an index on (tenant_id), so the
-- admin dashboard's "scans in the last N days" (tenant_id + scanned_at) and the
-- superadmin overview's cross-tenant "scans today" (scanned_at across all
-- tenants) both fell back to scanning every matching row. orders had no
-- (tenant_id, created_at) index for the KDS windowed load.
--
-- Plain CREATE INDEX (not CONCURRENTLY) so the ad-hoc migration runner can apply
-- it inside its transaction; these tables are small enough today that the brief
-- lock is acceptable. IF NOT EXISTS keeps it idempotent.

CREATE INDEX IF NOT EXISTS idx_scan_events_tenant_scanned
  ON scan_events (tenant_id, scanned_at DESC);

CREATE INDEX IF NOT EXISTS idx_scan_events_scanned
  ON scan_events (scanned_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_tenant_created
  ON orders (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_tenant_status
  ON orders (tenant_id, status);
