# Owned admin locations and delivery zones

When `OWNED_ADMIN_MENUS_ENABLED=true`, the Locations page and its collection/item API use the existing `ADMIN_MENUS` PostgreSQL pool. Delivery-zone collection/item APIs use the same pool. There is no additional pool or schema migration.

Location reads are scoped to the authenticated effective tenant. Create and update use server-derived tenant IDs; optional menu assignments lock and verify a menu belonging to that tenant. The current Locations UI and API support list, create, and update; they do not expose location deletion.

Delivery-zone mutations preserve the existing Menu + Payments entitlement. The active/trial plan is checked in the same transaction as each mutation, with subscription and plan rows locked during writes. Deleting a zone keeps the database `ON DELETE SET NULL` behavior for its orders and refuses corrupt cross-tenant order references.

The legacy Supabase paths remain active when the flag is false. Store settings, Stripe, and the rest of the admin back office are outside this slice and must be reviewed before enabling the shared flag broadly.
