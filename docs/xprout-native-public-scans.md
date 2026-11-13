# Native public QR scans

`OWNED_ADMIN_MENUS_ENABLED` selects the native public scan writer before any source client is created. The existing administrative pool (two connections), transaction deadlines and rate limit are reused. Native requests share the bounded public analytics body reader (64 KiB/five seconds). No DDL, additional pool, credentials or live flags change.

Each accepted visit inserts one distinct `scan_events` row for exactly the supplied active tenant. A single parameterized `INSERT ... SELECT` enforces that predicate. The database generates the ID and timestamp; extra request fields never become QR, location, country, user-agent or timestamp values. There is deliberately no new deduplication contract. Inactive/absent tenants return 404. Native database failures return 503 without a source fallback or success acknowledgement; the browser continues to treat scan recording as best effort. The legacy flag-off branch is preserved.

Five offline cases cover SQL parameterization, missing/invalid tenants, native selection, failure and the legacy branch. Three disposable PostgreSQL cases cover concurrent distinct scans, active-tenant admission and transaction rollback. Projection fixtures do not prove production grants. Production write barriers, reconciliation and reviewed rollout remain separate gates.
