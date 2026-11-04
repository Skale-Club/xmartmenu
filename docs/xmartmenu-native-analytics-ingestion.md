# Native public analytics writer

The existing `OWNED_ADMIN_MENUS_ENABLED` flag selects native ingestion before creating a source client. All live flags, database roles, credentials and data remain unchanged. The writer shares the existing administrative pool of two connections and its eight-second transaction budget.

The existing strict batch/event schemas, event-time limits, rate limit and response shape remain in force. Native body reads are actually bounded to 64 KiB and five seconds, including stalled streams/cancellation. Trusted order events, amounts, order IDs and server event keys cannot enter this client-only writer.

One transaction validates the active tenant/menu, analytics switch, tenant/menu-bound product/category IDs and compatible location/QR references. Disabled analytics returns `received: 0` without writing. The session upsert compares the immutable tuple `(id, tenant_id, menu_id, location_id, qr_code_id, is_test)` in PostgreSQL. Concurrent identities cannot steal a session UUID. Replays keep first-visit metadata and start time; last-seen uses `GREATEST` so reordered requests or clocks cannot move it backward.

Events use the existing unique `client_event_id` with `ON CONFLICT DO NOTHING`. Duplicate IDs never overwrite prior fields. The acknowledgement remains the submitted event count, including replays, matching legacy `ignoreDuplicates`. Session and event changes now commit together; an event failure rolls back both a new session and a last-seen update. There is no SQL retry or source write fallback after a native failure. The flag-off source path remains available until cutover.

Seven disposable PostgreSQL cases cover concurrent exact replay, immutable tuple conflicts, first-use cross-tenant races, monotonic clocks/metadata, foreign entity rejection, disabled analytics and atomic rollback on event failure. Offline cases cover excluded financial fields/events, native source selection, deadlines and oversized/stalled bodies. These projection/FK fixtures do not replace production grant/traffic acceptance.

No production DDL, grants, RPC execution, new pool, provider call or deployment is introduced. Final source reconciliation/write barrier, remaining source consumers and reviewed rollout/rollback gates still apply. Trusted order/payment analytics continue through their existing selected adapters; dashboard reads were migrated separately in PR39.
