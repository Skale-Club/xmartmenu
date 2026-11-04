# PostgreSQL placement and rehearsal inventory

Read-only observation window: 2026-11-03 23:56–23:58 UTC and
2026-11-04 00:01–00:03 UTC. No database, token, network, host configuration,
application environment, container lifecycle or permission was changed.

## Persistent production candidate: admission denied

SSH used the existing agent and known-host verification for
`root@coolify.skale.club`, without a new key, tunnel or UI session.

| Measurement | First sample | Second sample |
| --- | --- | --- |
| CPU | 4 logical CPUs, load 0.59/1.01/1.07 | current samples 53–94% idle |
| RAM | 7,751 MiB total, 989 MiB available | 1,005 MiB available |
| Swap allocated/used | 4,095/1,482 MiB | 4,095/1,478 MiB |
| Current swap activity | swap-in 0–4 KiB/s, swap-out 0 | swap-in peak 680 KiB/s, swap-out 0 |
| Memory PSI | avg60 some/full 0.10/0.09%; avg300 0.72/0.58% | avg60 0/0%; avg300 0.46/0.37% |
| Disk | 13,707 MiB available, 82% used | same filesystem/availability |

The first `vmstat` row is the lifetime average and is not a current sample.
Current swap-out was zero, but recent pressure and approximately 1 GiB available
do not admit another 512 MiB database plus a 128 MiB client while retaining an
adequate host reserve. The coordinator denied placement. Do not lower the
database budget, prune another app or weaken admission merely to make it pass.

The production XmartMenu container remains healthy for application UUID
`gmaayluj11x1m6j7baogonfn`, deployment timestamp `20261102T010249`, image tag
`ghcr.io/skale-club/xmartmenu:e5b1fb54ddc55a3445bd115a5973e4e30cb48876` and image ID
`sha256:06645e194800d6ed0ef8e2e729991affd14c6bec057a1e98e71359062d4a58b6`.
Its only runtime network is the existing attachable bridge
`gmaayluj11x1m6j7baogonfn` (also attached to the proxy), not the default `coolify`
network. No network was attached or created by this inventory.

**Excluded resource:** `7l8mjbkk16mk0ss9dviw9lzj` is `xpot-db`, healthy and
persistent, with a 512 MiB limit. It belongs to Xpot. It is not a spare database
and must not be reset, reassigned, resized, stopped or used for this migration.

## Coolify metadata and supported API path

Coolify 4.5.3's installed Laravel source was read over SSH. Metadata SELECTs were
inside an explicit READ ONLY transaction followed by rollback. No environment
values, passwords, token hashes or plaintext tokens were printed.

| Object | ID / UUID |
| --- | --- |
| Application | 2 / `gmaayluj11x1m6j7baogonfn` |
| Project | 1 / `mgicva9yupu98s1gphnfdqkn` (`skale-apps`) |
| Environment | 1 / `c1476rb2s72hvebwbqqwtjgl` (`production`) |
| Server | 0 / `l89fh3suudgzng68scvyi525` (`localhost`) |
| Registered destination | 0 / `vavwixzo83p7f99qmkx3e9gn`, network `coolify` |
| Team / current owner | team 0 / user 0 |

Only that one destination is registered. Consequently, creating PostgreSQL using
the existing destination would put it on `coolify`; it would not automatically
give the app connectivity from its separate Compose network. Persistent network
placement and lifecycle handling are an unresolved cutover gate. No ad hoc
network attachment, new destination, tunnel or app restart is authorized here.

Installed source confirms:

- `routes/api.php:319`: `POST /api/v1/databases/postgresql` requires `write`.
  Starting the new resource, or requesting `instant_deploy`, also requires
  `deploy`; status inspection requires `read`.
- `DatabasesController::create_database` validates the exact project,
  environment, server and destination. It accepts private/public state, an
  explicit PostgreSQL 17 image, memory/swap/CPU limits and base64 PostgreSQL
  configuration. Set `is_public=false`, omit a public port, and initially use
  `instant_deploy=false` to inspect the resource before a separately admitted start.
- The model creates a named `postgres-data-<new-uuid>` volume at
  `/var/lib/postgresql/data` for PG17. StartPostgresql mounts that volume and
  enforces configured memory/combined-swap/CPU limits.
- Without `read:sensitive` or `root`, the create response contains the new UUID
  without credential-bearing connection URLs. Neither sensitive scope nor root
  scope is necessary for the proposed creation/status/start operations.
- Tokens are team-bound and role-checked. The installed `User::createToken`
  accepts an explicit team and `expires_at`; Sanctum rejects expired tokens.
  Existing token records are hashes, not recoverable API credentials. Three
  unexpired team-token records were counted; no secret was read or recovered.

If an existing appropriately scoped credential is unavailable in a future
approved capacity window, the supported model can issue a short-lived token for
owner user 0/team 0 with only `read`, `write`, `deploy`, e.g. ten-minute expiry.
Keep plaintext only in remote process memory, make requests over container-local
loopback (`127.0.0.1:8080` inside Coolify), and revoke that exact token in `finally`.
Leave API/IP settings untouched; refusal by the existing allowlist is a gate.
Do not save a permanent token or use public plaintext HTTP. These scopes still
cover the team rather than one resource, so the future operator script must pin
the new candidate UUID and refuse every existing database UUID. No token was
created during this inventory.

Official references: [permissions](https://coolify.io/docs/api/permissions),
[authorization](https://coolify.io/docs/api/authorization),
[API tokens](https://coolify.io/docs/core/security/credentials/api-tokens),
[PostgreSQL](https://coolify.io/docs/databases/postgresql). Installed version
source, rather than a newer documentation example, controls the exact fields.

## Alternative host: temporary rehearsal only

Fresh SSH observation of `root@49.13.197.250` (`skaleclub-mail`) at
2026-11-04 00:01 UTC found 2 CPUs, load 0.34/0.38/0.36, 3,819 MiB RAM with
1,620 MiB available, 510 MiB swap used and current swap-in/out both zero.
Memory PSI avg60 was 0.01% some / 0% full, with 81–96% CPU idle in current
samples. `/tmp`, `/opt` and Docker share the root filesystem, with 10,421 MiB free.
The already cached PG17 image is exactly
`sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b`.
These observations support proposing a tightly bounded temporary rehearsal;
they are not execution approval and must be repeated immediately before a run.
The populated Xmail candidate and all existing volumes/backups remain excluded.

## Fresh source compatibility audit

The existing sibling checkout's `.env.local` was read in memory. Credentials were
not copied into this worktree or printed. Both probes pinned source project
`ktogbpqookfcqilqvici`, session/direct port 5432, the official pinned Supabase CA
and full hostname/certificate verification. Every query ran inside a bounded
REPEATABLE READ READ ONLY transaction followed by rollback. No export or dump ran.

At 2026-11-04 00:02–00:03 UTC: PG17.6, database size 20,343,955 bytes; all 47
public tables readable without RLS filtering; seven auth UUIDs and seven profiles
with no unmatched IDs, one superadmin, three store admins and three customers;
three tenants, 56 products, two orders and six items. The cancelled order totals
247.90, the pending order 77.90; both currencies remain SQL NULL. The source
ledger has 92 records through `20261027097000`; known missing historical local
ledger entries must not be repaired with db push or all-migration replay.

Four public foreign keys reference `auth.users(id)`: profiles and customer
profiles cascade, while order customer and waiter-call acknowledger use SET NULL.
Public policies name `authenticated`, `service_role` and PostgreSQL's implicit
`public` role. Policies and three SQL authorization helpers call `auth.uid()`;
the profile-privilege trigger calls **`auth.role()`** too. Twenty-one public
function definitions were inspected in memory and reduced to code fingerprints
and dependency metadata: no HTTP/net/vault/storage call was found. No external
column types or extension-owned public objects were found; default/constraint
expressions referenced only `auth` outside the selected schemas.

The database also has provider event triggers in `extensions` and the public
`ensure_rls`/`rls_auto_enable` pair. A rehearsal must inspect the archive TOC and
refuse unreviewed global/provider objects; it must not silently import vendor
network workers or rewrite function bodies/COPY data.

A minimal target-only compatibility scaffold may therefore need
`auth.users(id uuid PRIMARY KEY)` with the seven exact original UUIDs,
NULL-returning `auth.uid()` and `auth.role()` helpers, and `authenticated` plus
`service_role` as NOLOGIN/NOBYPASSRLS roles. Revoke public helper execution.
It must copy no auth sessions, refresh/provider tokens, password hashes or auth
server credentials. This scaffold permits app-schema restoration and ID/FK
comparison only; **it is not migrated login or production authorization**.

## Prepared next code slice (not executed)

The separate [XmartMenu default-plan rehearsal protocol](xmartmenu-database-rehearsal.md) and offline tests are prepared,
borrowing Xmail V2's one exported snapshot and source/target canonical comparison
without changing the reviewed Xmail implementation. Files would separate source
admission/manifest/snapshot orchestration, a host-bound bounded shell runner,
authenticated archive encryption, offline policy/fixture tests and the runbook.
CI would run only offline synthetic tests: no source credentials, SSH secret,
customer data, dumps or digest artifacts would be configured there.

Proposed runtime phases:

1. Recheck the exact Xmail host/image, available memory, active swap/PSI, CPU and
   disk. Retain a substantial host reserve; use an initial 1,536 MiB available-RAM
   gate, no active swap-out, low memory PSI and at least 2 GiB free. Abort on a
   failed gate rather than tune the budget during a run.
2. Keep source credentials in memory/SSH stdin only. One TLS-verified exported
   REPEATABLE READ READ ONLY snapshot must cover the app/ledger dump, minimal
   auth UUID set, all 47 counts, critical UUID/profile/role/tenant/order/item
   digests, subscription/capability records and NULL-preserving order totals.
   Maintain the snapshot until the source dump is complete, then explicitly
   roll it back. Never authorize or associate by email/phone matching.
3. Use the pinned PG17 source client capped at 128 MiB/no extra swap and a
   separate, similarly bounded crypto helper based on an already cached image.
   Store only an authenticated encrypted custom archive in a private bounded
   tmpfs; encryption keys must not enter argv, logs or permanent files. Verify
   authentication before any decrypted SQL reaches the restore path.
4. Restore into a newly named, run-labeled PG17 container with network none,
   no ports, no writable persistent mount, 256 MiB/no extra swap, 0.5 CPU,
   small shared/work/maintenance buffers and a bounded data tmpfs. Bootstrap
   only the reviewed non-authenticating compatibility scaffold. Restore only
   the reviewed archive sections; compare canonical counts/digests/totals and
   critical ID/role/tenant associations before declaring success. No app,
   worker, provider integration or trigger test may send external effects.
5. Source/archive/restore phases have independent deadlines and size limits.
   Cleanup may remove only this run's matching labels, private tmpfs and
   ephemeral crypto state, never Xmail's populated candidate, any persistent
   volume or existing backup. Print aggregate booleans/counts only after
   proving removal; do not return raw IDs, rows, ciphertext, digests or errors.

The target/client/crypto/tmpfs aggregate must be accounted for by phase before
implementation review, not treated as free memory. Real execution remains
subject to coordinator review of the exact protocol and a fresh host window.
