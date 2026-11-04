# Owned QR codes and table catalog

When `OWNED_ADMIN_MENUS_ENABLED=true`, the QR Codes screen and the restaurant table catalog use the existing `ADMIN_MENUS` PostgreSQL pool. QR targets are composed on the server from the authenticated tenant slug and its currently selected menu; clients cannot supply a tenant ID or arbitrary target URL.

Table create derives tenant and position server-side. Reordering locks and swaps the two tenant-owned rows in one transaction. Table delete retains the existing free-text order behavior. QR delete preserves `scan_events.qr_code_id ON DELETE SET NULL`.

The basic waiter-call flow remains separate. It includes a public rate-limited create/reopen path and an `acknowledged_by` foreign key to Supabase `auth.users`; it needs a reviewed identity and rate-limit plan before migration. No feature flag is changed by this slice.
