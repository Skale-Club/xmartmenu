# XmartMenu: Supabase production exit

Date: 2026-11-03 (America/New_York). Program: `../xmail/docs/supabase-exit-plan.md` in the sibling Xmail checkout.

## Status and source

Migration in progress; production has NOT been cut over. No source writes, Google changes, database provisioning or deployment have been performed by this work.

Before editing, `git fetch origin` confirmed clean local HEAD, main and origin/main all at `e5b1fb54ddc55a3445bd115a5973e4e30cb48876`. Branch: `codex/xmartmenu-supabase-exit`. No root AGENTS.md/CLAUDE.md or applicable parent instructions were present in this checkout. Read README, guest-login, migration runbook, prior release runbook and the portfolio plan.

Production image inspected over SSH: `ghcr.io/skale-club/xmartmenu:e5b1fb54ddc55a3445bd115a5973e4e30cb48876`. Coolify application `gmaayluj11x1m6j7baogonfn` is running/healthy on main. Current routing is Coolify/Traefik; a staging domain on the same app is NOT an isolated staging database. The locally configured Coolify base already includes `/api/v1`; normalize it to its origin before adding an API path. Read-only API access verified the application/env inventory and only one managed PostgreSQL resource (`xpot-db`).

## Read-only baseline

Reproducible sanitized evidence: [supabase-exit-baseline.json](supabase-exit-baseline.json), generated with `node scripts/supabase-exit-inventory.mjs --source-read-only`. The script runs sequential queries in a read-only repeatable-read transaction with bounded connection/query timeouts. It prints metadata and aggregate counts, not user rows, tokens or connection strings.

| Item | Observed |
| --- | --- |
| Source | Supabase project `ktogbpqookfcqilqvici`, PostgreSQL 17.6, approximately 20 MB |
| Tables/security | 47 public tables, all with RLS; 70 public policies |
| Accounts | 7 users and 7 profiles, no orphans; 1 superadmin, 3 store-admin, 3 customer |
| Providers | 2 Google identities, 5 email identities; 0 verified phones; 0 currently banned accounts |
| Business data | 3 tenants, 56 products, 2 orders/6 items, 3 tenant subscriptions; 0 waiter calls at snapshot |
| Migration ledger | 92 records; latest `20261027097000`; keep historical files/ledger intact |
| Files | Production selects R2 (`s3`), all required S3 settings present; old public Supabase tenant-assets still has 4 objects, 17,971,466 bytes |
| Production integration presence | Xphere producer, API credentials and QStash configured; Stripe secret empty |
| Legacy identity | Google enabled, phone disabled, Supabase OAuth server enabled; legacy Google web client project number begins `805069132783` |

Coordinator recheck on 2026-11-03 used the existing local source configuration,
the official CA with full TLS verification and read-only queries. It confirmed
47 public tables with SELECT access to all 47, database size 20,311,187 bytes,
one `platform_settings` row and zero newly added identity-pilot tables in the
live source. No DDL or source mutation ran. These aggregate observations support
the appearance reader's source shape and confirm that the pilot schema remains
unapplied; they do not prove a restored destination, refreshed ledger or cutover.

No real SMS or interactive Google sign-in was performed. Existing OAuth client alone does not establish an Identity Platform project. Read-only public Identity Toolkit configuration confirms the Xpot reference is `skaleclub` (project number `937861185231`), distinct from the old XmartMenu OAuth project. Its authorized-domain list includes Xpot/Xpeed and localhost, but not XmartMenu. Default to `skaleclub`, but verify whether the existing Google project is already suitable before creating a product-specific client. Do not edit shared authorized domains, providers, SMS regions, quotas or hooks without coordination.

A further sequential read-only probe found no source-project Supabase URL in any public text/JSON column. R2 lists 4 tenant-asset objects totaling 17,971,466 bytes and zero product-image objects. All four old Supabase object keys exist in R2 (HEAD); checksums/content equivalence are not yet proven. The two historical orders total 247.90 cancelled and 77.90 pending; both have NULL currency. Preserve the NULL values during copy and resolve currency from historical business context, without silently treating them as USD. The application has 56 product records, but images may be external URLs; zero R2 product objects does not establish missing media.

Host read-only probe on 2026-11-03: 7,751 MiB total RAM, 1,257 MiB available, 1,450 MiB swap used; root disk 75G total, 61G used, 12G available (85%). Sent these observations to the Xmail chat. They do not approve placement of a new database/container. No pruning, host configuration or shared PostgreSQL changes were made.

The locally available Supabase management credential lists only the source XmartMenu project. A distinct development project is not configured. `npm run dev` now refuses this source configuration rather than writing production. Do not silently repurpose the source as development or borrow another application's shared schema. The user prefers reusing existing databases and does not authorize paid Supabase projects, upgrades or new spending. The coordinator will inventory reuse after production cutover and source retirement/restore checks; an old database is eligible only after explicit reassignment and isolation, never while it remains a live production dependency. Missing isolated development configuration remains a fail-closed gate, not a request to buy capacity.

## Implemented increment

- `npm run dev` requires `DEV_SUPABASE_*` and `DEV_DATABASE_URL` matching a separate Supabase project; legacy production aliases cannot satisfy it. External billing, AI, QStash and Xphere producer environment credentials are disabled in this local command. No production data snapshot runs automatically.
- Both migration entrypoints use explicit targets. Default: isolated Supabase development. Production requires independent `PROD_MIGRATION_DATABASE_URL` plus matching host/database and the `--coordinated-cutover` flag for writes. The flag records an operator's decision; it does not acquire a cross-chat deployment lock. Simulation remains the default and each applied file shares a transaction with its ledger record.
- Additive `20261103190000_application_identity.sql` prepares empty app-account, provider-binding and hashed-session tables with backend-only privileges. It performs no backfill, creates no users, changes no roles and retires no login path.
- Signed Identity Platform verification pins project/issuer/audience, RS256 and expiry; rejects future authentication, tenant identities and unsupported providers. New account bindings require recent authentication. Signed provider claims never supply application roles. Implementation follows [Google's ID-token verification contract](https://firebase.google.com/docs/auth/admin/verify-id-tokens).
- Identity policy preserves app UUIDs: existing binding, valid legacy-session ownership, or exact unique signed Google provider-subject association. Verified email or an unverified profile phone is never enough. Unmatched identities require recovery; new-customer onboarding will be a separate explicit path.
- Transactional identity store serializes concurrent first association, stores only random-session token hashes, honors account disabling, expiry, logout and all-session version revocation. No HTTP exchange endpoint or login UI activates this store yet; authorization remains on the existing production path until compatible repositories are ready.
- Session provenance/liveness continuation: `20261103200000_identity_session_provenance.sql` adds the exact provider project/subject and an account-consistent binding foreign key to owned sessions. Reads require a locally active binding and a fresh provider account-status lookup; Google disable/revocation or a lookup failure denies access. Binding and session creation require a sign-in within five minutes. Existing preparatory sessions without provenance require a fresh sign-in; account UUIDs, memberships and roles are unchanged. Apply only after the original identity migration in an isolated rehearsal.
- The provider reader uses the fixed Identity Toolkit `accounts:lookup` endpoint and exact immutable UID, requiring only `firebaseauth.users.get`. Its credential callback must supply a short-lived Google OAuth token using ADC/federation; no JSON service-account key is created or accepted by this increment. Credential/transport errors are sanitized. An operational credential binding and HTTP integration are still release gates; these modules do not activate new production authentication.
- Orders and waiter screens use existing tenant-authorized HTTP APIs instead of direct Supabase Realtime. Polling runs at 5s after completion, pauses hidden tabs, aborts on exit/timeout, prevents overlap and backs off to 30s on failures. Pending/paid arrivals retain sound notifications. This introduces up to one poll interval of normal update latency.
- Remote CI now includes independent PostgreSQL 17 identity integration tests, and deploy depends on that job as well as existing checks/E2E. Existing CI still validates the legacy application with disposable Supabase; this is transition evidence, not proof of complete production independence.

## Remaining dependency map and release order

Repository scan at baseline found 193 source files referencing Supabase factories/auth, RPCs, Storage or Realtime. These require feature-level server repositories and authorization tests; changing the database URL is insufficient.

1. **Complete destination/identity dossier.** Inventory existing PostgreSQL/Supabase resources with the coordinator and reuse approved capacity after dependency, backup and isolation checks. Do not provision paid projects, upgrade plans or incur new expenses. Configure isolated Supabase dev only from a safely reassigned existing resource; verify Google project/client/provider settings and SMS countries. Define backup storage and retention before copying live data.
2. **Independent data boundaries.** Move tenant resolution, platform settings/public catalog, customer history, admin catalog/staff, orders/payments, waiter calls, analytics/blog/AI and Xphere workers in distinct increments. Preserve RLS or equivalent tenant and role checks. Direct browser CRUD still exists in catalog/settings/onboarding; migrate it to authenticated routes before auth cutover. Drain/reconcile QStash workers and acknowledged webhooks.
3. **Accounts and identity transition.** Reconcile all seven account UUIDs and roles. Bootstrap `app_accounts` in a separate audited transaction; preserve blocked/deleted state. The two existing Google accounts can prove their exact provider subject. The five email identities need still-valid legacy session plus fresh new identity or documented operator recovery. Staff invitations must stop creating temporary passwords only after replacement is usable. Keep phone a verified mutable attribute, not an owner key. Google users must verify phone before claiming anonymous orders by exact full E.164; define number recycling/recovery, unlinking and provider revocation.
4. **Separate authentication release.** Add app-only secure HttpOnly session cookies, origin/CSRF checks, rate limits, fresh identity linking, current app DB role checks, all-device/provider revocation and recovery. Integrate every protected page/API, custom domains and logout cache clearing. No email-based superadmin promotion in the new path. Retire password/email-OTP only after all cohorts have a working path.
5. **Independent PostgreSQL release.** Restore rehearsed schema/data with original UUIDs and keys, constraints/sequences/functions and tenant boundaries intact. Replace public FKs into auth.users (profiles, customer_profiles, orders, waiter acknowledgements), `auth.uid()` context and profile/audit triggers deliberately. Keep historical migrations; do not ship a full Supabase stack as the destination. Freeze writers, workers, onboarding and webhook ingestion or queue durably for final copy.
6. **Files and machine auth release.** Inventory both R2 buckets and remaining Supabase objects/references, archive/checksum before switching any URLs, preserve source objects. Historical superadmin migrate-webp route still bypasses storage abstraction. Replace Supabase OAuth authorization/consent/JWT verification for MCP with independent OAuth while preserving scopes, revocation and superadmin authorization; keep Stripe OAuth separate.
7. **Independence and observation.** Production boot/core flows with Supabase unavailable; remote integration/E2E, independent backup restore, exact deployed SHA, source traffic classification, seven-day observation including real jobs and backup cycle. Retire only obsolete production credentials after rollback is no longer needed; retain isolated dev credentials.

## Cutover acceptance and rollback

Before any production window, demonstrate an isolated restore and record checksum/manifests, row/ID counts, order totals by currency/status, items, subscriptions/Stripe IDs and file permissions. Inventory and preserve encryption keys; never put dumps/runtime secrets in Git. For this small order workload, provisional targets are RPO 0 acknowledged orders/payments during cutover (durable ingestion or writer freeze) and RTO 30 minutes, pending measured rehearsal. External daily backups alone do not meet RPO 0; add WAL/PITR or a proven durable replay source before cutover.

Abort the window for any missing account/role/tenant, any mismatched order/financial total or file checksum, any cross-tenant access, restore exceeding 30 minutes, or repeated core-flow failures (3 consecutive probes). Declare a fresh capacity limit with the coordinator before starting a database or deployment; do not substitute the snapshot above for admission control.

Before new writes, rollback can use the old image/target. After new writes, freeze writers and reconcile/replay the new target's changes before reverting; never point at a stale Supabase database. Keep additive schemas and old images compatible during transition. No source deletion is authorized by this document.

## Validation record

Locally: 28 focused target/Google-claim/ownership tests, then 3 polling tests passed sequentially; targeted ESLint had no errors (existing OrdersClient warnings remain). `npm run dev` rejected the current production-source-only local configuration as intended. No local build, Docker service, full test suite or live migration ran. CI evidence is recorded below after the remote run completes.

Continuation on 2026-11-03: the existing remote baseline is PR #26, HEAD
`78eb523c19996359753a667be433122f6c55c278`; its checks, E2E and independent
PostgreSQL identity job passed. New focused tests cover provider lookup
validation, no caching of revocation state, sanitized failures and denial before
database effects. The disposable PostgreSQL suite additionally checks live
revocation, provider unavailability, local binding disablement, account-consistent
session provenance and sessions without provenance. The PostgreSQL additions
must run in CI; no production migration or provider change has been made.

The liveness increment was published as `dfd5917d4c142687cade7958c75cd30854b51239`.
[CI 41716176961](https://github.com/Skale-Club/xmartmenu/actions/runs/41716176961)
passed checks, the real disposable PostgreSQL job, production build and
Playwright. Deploy was skipped for this PR. This evidence covers the increment,
not production cutover or real Google/SMS verification.

## Isolated identity pilot

`/identity` and `/api/identity/*` are opt-in through `GOOGLE_AUTH_ENABLED=true`;
the example/default remains false. Configure `IDENTITY_ORIGIN` explicitly, the
Google project/public web key, and renewable read-only ADC/workload credentials.
The Codex OIDC connection is an audit identity and does not by itself establish
renewable credentials inside the Hetzner application container. Do not copy its
short-lived token or create a JSON private key to bridge that gap.

Development uses only the guarded dedicated `DEV_*` project/database. Production
pilot runtime additionally requires `IDENTITY_DATABASE_URL` matching
`PROD_DATABASE_HOST`/`PROD_DATABASE_NAME` on independent PostgreSQL; legacy SQL
aliases cannot satisfy it. TLS is mandatory for development. Private production
Docker networking can use explicit `IDENTITY_DATABASE_SSL=disable` after the
destination has been verified. Before enabling a rehearsal, apply the three
additive identity migrations in order and bootstrap `app_accounts` only from
the reviewed exact-ID manifest of the isolated accounts. No account bootstrap,
copy, migration or environment activation runs automatically.

Google development is isolated too: `DEV_GOOGLE_AUTH_PROJECT_ID`,
`DEV_GOOGLE_AUTH_PROJECT_NUMBER` and `DEV_GOOGLE_AUTH_WEB_API_KEY` are mandatory
and cannot fall back to production variables. `skaleclub`/`937861185231` and the
configured production ID/number are rejected for development. The official
read-only Identity Toolkit `GET /v1/projects` must prove the API key belongs to
the reviewed ID/number pair and includes the default Firebase domain plus the
canonical origin's hostname. The key is sent in `X-Goog-Api-Key`, never the URL;
there are no deprecated project-number query overrides. A missing/mismatched
response or timeout fails closed. Both the server-rendered page and every
mutable browser authentication action require this proof before SDK use;
previous initialization does not bypass a subsequently disabled flag. No dev
Google project/key was created and no shared Google grant was changed here.

Connection strings accept only `sslmode` and `application_name` query options.
Other/duplicate options are rejected before pg parsing: its `host`/`user`/`port`
query precedence must not override the validated authority. Supabase development
always uses full TLS verification, including migration commands. Offline tests
inspect pg.Client's effective parameters without connecting. Legacy account
proof uses the exact online `/auth/v1/user` endpoint with the public anon key,
bounded to eight seconds, redirect rejection and caller cancellation. The direct
reader avoids credential-bearing SDK error logs and never falls back to JWT
claims, email or phone.

The browser uses Firebase memory-only persistence for phone/SMS or Google proof,
then signs out of Firebase and exchanges the proof only with its own origin.
Owned session cookies are host-only, HttpOnly, Secure on HTTPS, SameSite=Lax and
bounded by the store's absolute eight-hour deadline. A separate two-minute
cookie challenge is hashed in PostgreSQL and claimed atomically, preventing
replayed login/link requests. Missing/wrong Origin, another host, malformed or
oversized/slow bodies, and exhausted limits are rejected before mutation. No
provider token appears in a redirect or response. Provider/account lookups fail
closed and errors omit credential-bearing SDK details.

Login uses an existing immutable binding. Linking requires a fresh provider
proof plus either a still-valid online legacy UID proof for that exact account,
or a recent live-checked owned session. Preview sessions, conflicting owners and
expired/replayed challenges are refused. Neither email/phone profile matches nor
`SUPERADMIN_EMAILS` grant authority. No new account, tenant membership or role is
created; unmatched identities require the separately reviewed recovery process.

The pilot can verify a session, link a sign-in method, sign out or revoke all
owned sessions. It does not replace existing admin/customer guards, the default
login, machine OAuth, invites or recovery. Other/custom origins fail closed until
their explicit browser-bound handoff is implemented and tested. The application
root appearance defaults to Supabase; its separate opt-in PostgreSQL reader is
described below. Other layouts and public pages still use Supabase. This pilot
is not evidence of a completed exit.

## PostgreSQL repository replacement order

| Order | Boundary and current entrypoints | Required compatibility before switching |
| --- | --- | --- |
| 1 | Verified host/tenant resolution in `src/middleware.ts`; root appearance in `src/app/layout.tsx` | Exact verified hostname/active-tenant checks, safe miss caching, public appearance projection, no legacy network dependency at boot. |
| 2 | Public menu in `src/lib/menu/public-menu-data.ts`, tenant plan and chat-addon helpers | Tenant-scoped menus/categories/products/options/ingredients/media, branches/tables/zones, private-menu gate outside shared cache, immediate invalidation. |
| 3 | Principal/roles in `src/lib/get-effective-tenant.ts` and `src/lib/superadmin-auth.ts` | Reviewed original account IDs/roles, fresh DB role reads, preview boundaries, disabled users, removal of email auto-promotion; deliberate replacement of `auth.users` FKs and `auth.uid()` context. |
| 4 | Admin catalog/settings/staff and onboarding routes plus direct browser CRUD | Authenticated tenant/role checks for every write, transactional onboarding/invites, audited mutations and equivalent RLS/authorization. Browser CRUD must stop before identity cutover. |
| 5 | Order/payment/customer-history routes and their SQL RPCs | Preserve immutable IDs, atomic order/items/idempotency, verified full E.164 claims, signed payment transitions and historical currency/financial totals. |
| 6 | Waiter calls, chat and media writers | Tenant authorization, polling/cancellation, file references and private storage boundaries; replace historical direct Supabase media migration route. |
| 7 | Analytics/blog/AI, Xphere and QStash workers | Scoped aggregates, scheduled-job auth, billing idempotency, durable drain/replay; staging must not call production side effects. |
| 8 | MCP OAuth/consent/JWT verification and administrative identity lifecycle | Independent machine auth/scopes/revocation, reviewed recovery, grants/invites/deletion; preserve Stripe OAuth as a separate integration. |

These boundaries can be implemented in separate owned modules/PRs, but share the
same identity, tenant, cache and migration contracts. Keep the source ledger and
data intact; coordinate schema/deploys, rehearse restoration and verify exact
deployed SHA before removing any production Supabase credential.

## First SQL boundary: public root appearance

`OWNED_PLATFORM_APPEARANCE_ENABLED=false` preserves the legacy default. When
explicitly enabled, root metadata, viewport and layout share a request-scoped
reader selecting only `cta_color` and `favicon_url` from the restored
`public.platform_settings`. That path does not initialize a Supabase client,
Google provider, storage client or identity runtime. Owned errors do not fall
back to the source. A missing row uses the existing UI defaults; duplicate rows,
malformed values and database errors fail with a sanitized error.

Historical schema evidence: `004_platform_settings.sql` creates the original
UUID table and the unique singleton expression index; `019_full_schema_sync.sql`
only repeats an idempotent baseline; `045_platform_settings_columns.sql` adds
`cta_color`; `047_platform_favicon.sql` adds `favicon_url`. There is no new DDL or
ledger version for this read-only boundary. The recorded source ledger baseline
is still 92/latest `20261027097000`; it has not been read live again or replayed.
The three additive identity migrations remain separately unapplied in production.
Restore/reconcile those historical objects and original IDs before enabling the
reader; do not rerun `004` to create a second seed or rebuild an existing table.

Production requires explicit `PLATFORM_APPEARANCE_DATABASE_URL` matching
`PROD_DATABASE_HOST` and `PROD_DATABASE_NAME`. It cannot inherit `DATABASE_URL`,
the identity connection, or a Supabase host. Development uses the same guarded
isolated `DEV_DATABASE_URL` as the identity pilot and never reads production
provider/storage configuration. TLS is verified by default; private production
networking may explicitly set `PLATFORM_APPEARANCE_DATABASE_SSL=disable` after
destination review. Connection-query overrides remain rejected by the shared
guard. Configure a dedicated login with only schema USAGE and column-level
SELECT on these two fields; no credentials or grants are created by the app.

The pool has two connections, five-second connection/statement limits, a
six-second query limit, two-second lock limit and read-only transactions by
default. The projection reads at most two rows to verify the singleton. React
request caching shares a single snapshot among the three root consumers; there
is no cross-request TTL to hide a branding change. Private settings, IDs,
landing content and integration values are never serialized by this reader.

Disposable CI PostgreSQL tests use the real historical table/index DDL and
column migrations (without hosted Auth policies/triggers), preserve a restored
UUID, verify immediate changes, exercise column-only grants and reject writes
through the actual runtime pool. This does not move the superadmin/MCP writers,
marketing page, tenant resolution or menu consumers; after restore, keep the flag
off until the writer freeze/replay procedure keeps both targets consistent.

The reader was published as `2cc03fcd8768c0b14bfb200591916b7949e4cc6b`.
[CI 41726256143](https://github.com/Skale-Club/xmartmenu/actions/runs/41726256143)
passed 600 unit tests across 57 files, build/TypeScript, 113 Playwright tests,
Lighthouse and 17 real disposable PostgreSQL tests with zero skips (including
all six appearance cases). Deploy was skipped and both feature flags remain
off. This verifies the code increment rather than a live data migration.

## Second SQL boundary: public menu catalog

`OWNED_PUBLIC_MENU_ENABLED=false` keeps the existing default. Its explicit own
mode supplies the data consumed by `/[slug]`, `/[slug]/[menuSlug]`, metadata and
the existing public-menu API from independent PostgreSQL. The reader preserves
original UUIDs, slugs, branch/default-menu selection, translations, prices and
the existing public DTO. Numeric values are projected through PostgreSQL JSON
so `numeric` prices remain JavaScript numbers rather than pg's default numeric
strings. SQL queries list their public columns explicitly; new restored columns,
tenant CRM fields, integration credentials and chat provider keys cannot become
public accidentally.

Every selected tenant must be active. Menus, locations, categories, products,
tables and zones are scoped to its exact ID; product options, ingredients and
media additionally join the corresponding tenant and selected menu/product.
These joins reject mismatched historical simple foreign keys instead of trusting
an object ID alone. Plan capabilities retain the existing active/trial rule;
chat availability and channel switches retain the existing subscription/override
contract. The reader invokes no provider, RPC, billing or storage client and
owned errors never fall back to Supabase.

Production requires separate `PUBLIC_MENU_DATABASE_URL` and
`PUBLIC_MENU_DATABASE_SSL`, with the same exact independent host/database and
connection-option guards as the earlier repositories. The two-connection pool
defaults to read-only, with five-second connection/statement, six-second query
and two-second lock limits. All stages run in one read-only repeatable-read
transaction. An eight-second total deadline includes pool admission and destroys
a stalled or late-arriving connection without returning an active transaction
to the pool. Per-relation row
limits fail closed on overflow instead of silently truncating menus. No pool,
login, credential, grant, schema copy or new resource is provisioned by this code.

Cache entries use distinct `legacy` and `owned-v1` namespaces, including the
React request cache, and owned target configuration is checked even before a
warmed cache entry. Existing invalidation tags still expire both sources. The
visitor's private-menu access is checked on every request outside the shared
cache; a denied visitor receives no categories, products or details even if an
authorized visitor warmed that cache. The current private-session check and
middleware remain on the legacy identity path until their separate replacement;
this increment does not claim that public requests are fully Supabase-free.

There is no new migration or ledger version. The CI fixture composes actual
historical table CREATE and selected ADD COLUMN clauses (001/004/009/021/026/
030/036/041/042/043/044 and later public-column additions), omitting hosted Auth
policies, triggers, seeds and provider operations. Reconcile and restore those
objects before enabling the flag; do not run the whole historical ledger against
production. Restore/writer synchronization and existing admin/browser writes
remain cutover gates.

Local focused verification: 37 tests in four files passed, including source
selection/cache separation, per-visitor private access, parameterized tenant
queries, grouped DTOs and destruction of a stalled snapshot. After extending the
deadline to pool admission, all 13 SQL/snapshot unit cases passed, including
never-resolving acquisition and destruction of a late lease without any query.
Targeted ESLint,
TypeScript syntax parsing of the integration fixture and `git diff --check`
passed. Seven real PostgreSQL cases were added to CI for original IDs/prices,
foreign-tenant detail rejection, branch isolation, private markers, subscription
revocation, concurrent snapshot coherence/read-only behavior and column-only
reader grants. They have not been run locally. Full TypeScript/build/PG/E2E
validation belongs to the remote CI checkpoint for this increment; no live
source, production flag or deployment was changed.
