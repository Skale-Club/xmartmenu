# Owned Store settings

With `OWNED_ADMIN_MENUS_ENABLED=true`, `/settings/store` reads its regional, contact, business-hours, service-flag, and tenant-domain data from the existing `ADMIN_MENUS` PostgreSQL pool. The query returns an explicit list of fields and excludes stored provider credentials. The existing plan capability model is computed from the active tenant subscription and plan rows in SQL.

Regional settings, service flags, and custom-domain changes use same-origin, tenant-scoped SQL mutations. Plan-dependent service switches and tip presets check the live plan under row locks in the same write transaction. Domain verification preserves the existing DNS check and only marks a domain verified after that server-side check succeeds.

The flag remains off by default. Stripe Connect, billing/webhooks, table-management APIs, and storage uploads remain separate migrations and must be handled before the shared flag is enabled broadly.
