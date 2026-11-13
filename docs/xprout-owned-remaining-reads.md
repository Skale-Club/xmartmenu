# Owned mode: remaining reads, writes and the connection budget

Status: code only. Every `OWNED_*_ENABLED` flag stays `false`; with all of them
off nothing here changes behavior (the legacy Supabase paths are the same code).
No SQL is applied by this change.

## What "owned mode" means here

`ownedModeActive()` (`src/lib/data/owned-mode.ts`) is true when **any** of the 14
`OWNED_*_ENABLED` flags is exactly `true`. The boundaries below follow the union
of the flags instead of a single one, because once any boundary is owned the
Supabase copy of `platform_settings`, `tenants` and friends is stale: reading it
is wrong and writing it is silent data loss. In owned mode these paths never
fall back to Supabase, not even after an error.

Owned reads and writes use the back-office pool (`ADMIN_MENUS_DATABASE_URL`)
through `ownedAdminTransaction`; superadmin actions re-check the stored role in
SQL (`authorizeAdminActor`).

| Boundary | Owned behavior |
| --- | --- |
| `src/middleware.ts` custom-domain lookup | `middleware.ts` runs on the **Edge** runtime in Next 16 (only `proxy.ts` is Node), where `pg` cannot load. In owned mode it calls `GET /api/internal/resolve-domain` (Node route, loopback to `127.0.0.1:$PORT`, already exempt from the middleware). Hits cached 60 s, misses 30 s, failures 5 s, a stale hit survives an outage, cache capped at 5,000 hosts, implausible hosts never leave the Edge. The route answers 404 unless the call is loopback (`Host` 127.0.0.1/localhost/[::1], no `x-forwarded-for`). No new service. |
| `/api/health/ready` | Probes `public.plans` through the owned pool (3 s limit). Fixed error text `database unavailable`. Token-protected config shows `database_mode`. |
| `platform_settings` | Reads: marketing layout/page, legal pages, pending screen, superadmin page. Writes: `PATCH /api/superadmin/settings` (same-origin check, role re-checked in SQL, advisory lock shared with the native MCP writer, `updated_at=now()`). |
| SEO | Platform sitemap (tenants + platform blog), per-tenant `sitemap.xml`, per-tenant `robots.txt` (503 on failure, never a wrong `Disallow`), tenant Open Graph card (generic card on failure). The root `opengraph-image.tsx` has no data access. |
| Superadmin | `products-list`, launch checklist page and `PUT .../launch-checklist/[itemKey]` (before: always 503 in owned auth). The Supabase-client checklist helpers now throw in owned mode. |
| `/demo` | 503 in owned mode (it would create a Supabase Auth user). Legacy mode uses a fresh random password per hit (set and used in the same request); `DEMO_OWNER_PASSWORD` (>= 12 chars) only pins it. No fixed password in code. |
| `migrate-webp` | 410 in owned mode. |
| `/settings/password` | Redirects to `/dashboard` when `OWNED_AUTH_ENABLED=true` (no password exists). |
| Startup | `instrumentation.ts` refuses to boot in owned mode unless `STORAGE_PROVIDER=s3`, `ADMIN_MENUS_DATABASE_URL` is valid, and every configured runtime URL resolves to one database/role. `getStorageClient()` also throws without S3. |

## Connection budget

`xmartmenu_runtime` is limited to 12 connections, and the private transport has
12 channel slots of which one is the periodic heartbeat
(`docs/xprout-private-postgres-transport.md`). Coolify's rolling deployment
runs the old and the new container together:

```
2 containers x SHARED_POOL_MAX + 1 heartbeat <= 12   ->   SHARED_POOL_MAX = 5
2 x 5 + 1 = 11 slots used, 1 spare
```

Before, six pools of 2 meant 12 per container and 24 during a rollout.
`src/lib/data/shared-pool.ts` keeps one pool per distinct target (protocol,
credentials, host, port, database, TLS; `application_name` ignored), stored on
`globalThis` so duplicated route bundles cannot multiply it. IDENTITY, PLATFORM_APPEARANCE,
PUBLIC_MENU, ADMIN_MENUS, ORDERS and PAYMENTS all resolve to it when their URLs
match; a different role gets its own pool (its limit is counted separately).
The `createXPool` factories are unchanged for tests.

Consequences to know: requests now compete for 5 connections (5 s
`connectionTimeoutMillis` bounds the wait), the pool is not read-only by default
(reads and writes still open explicit `BEGIN ... READ ONLY` / `READ WRITE`), and
identity queries now run with the pool-wide `lock_timeout=2s` (was unbounded up
to the 5 s statement timeout).

## Out of scope

Legacy MCP tools (`src/lib/mcp/tools/*`) still use Supabase and are selected only
by `OWNED_MCP_ENABLED`; public blog pages, `(admin)/layout.tsx` and other legacy
Supabase readers are covered by their own flags/follow-ups.
