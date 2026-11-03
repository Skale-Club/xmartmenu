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

No real SMS or interactive Google sign-in was performed. Existing OAuth client alone does not establish an Identity Platform project. Read-only public Identity Toolkit configuration confirms the Xpot reference is `skaleclub` (project number `937861185231`), distinct from the old XmartMenu OAuth project. Its authorized-domain list includes Xpot/Xpeed and localhost, but not XmartMenu. Default to `skaleclub`, but verify whether the existing Google project is already suitable before creating a product-specific client. Do not edit shared authorized domains, providers, SMS regions, quotas or hooks without coordination.

A further sequential read-only probe found no source-project Supabase URL in any public text/JSON column. R2 lists 4 tenant-asset objects totaling 17,971,466 bytes and zero product-image objects. All four old Supabase object keys exist in R2 (HEAD); checksums/content equivalence are not yet proven. The two historical orders total 247.90 cancelled and 77.90 pending; both have NULL currency. Preserve the NULL values during copy and resolve currency from historical business context, without silently treating them as USD. The application has 56 product records, but images may be external URLs; zero R2 product objects does not establish missing media.

Host read-only probe on 2026-11-03: 7,751 MiB total RAM, 1,257 MiB available, 1,450 MiB swap used; root disk 75G total, 61G used, 12G available (85%). Sent these observations to the Xmail chat. They do not approve placement of a new database/container. No pruning, host configuration or shared PostgreSQL changes were made.

The locally available Supabase management credential lists only the source XmartMenu project. A distinct development project is not configured. `npm run dev` now refuses this source configuration rather than writing production. Do not silently repurpose the source as development or borrow another application's shared schema.

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

1. **Complete destination/identity dossier.** Allocate private PostgreSQL after capacity coordination, configure isolated Supabase dev, verify Google project/client/provider settings and SMS countries. Define backup storage and retention before copying live data.
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
