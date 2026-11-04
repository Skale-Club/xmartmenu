# Xmartmenu identity foundation preparation

The SQL compiler accepts only an offline plan and returns private SQL to a
reviewed caller. Separate hash-gated backup/apply operators default to plans.
Source controls travel only through private memory/stdin; no CLI prints accounts.
The reviewed foundation transaction completed after the compatibility fixes:
51 public tables, 95 migration rows and seven original account controls (one
disabled), with no bindings/sessions/challenges. A separate SSH postcheck matched
all 47 original business-table digests and dormant roles. App/login flags remain
disabled. Earlier refused/rolled-back attempts are recorded below.

## Completed foundation receipt

The coordinator explicitly reviewed compiler source
91e2ed9683bbbd6c3f8a0a0d2d41dc6630fd557a3b32d5a27e7edc4d00a7e1c5, host runner
37ca34c5435ef4c747a70ad5971acea2491503e7d5999056f3f8cf23ad31391d and execution
projection bcb353494fa1d45f722a1d2be6e4881b5e86b449310bef389e5c905733148bda.
HEAD 63268fb2a9e9042863f6d6bc9b4e33ef5797068f CI run 41876596110 had every
checks/PostgreSQL/E2E step, including Complete job, completed success. GitHub's
aggregate job/run status remained inconsistently in_progress; the coordinator
independently verified the real steps and explicitly accepted that evidence.
The operation records ciStepsCompletedSuccess=true/ciAggregateStatusStale=true,
not a nominal successful badge or a test/security override.

One fresh READ ONLY source capture matched 44 full business-table digests and
all six UUID/authority groups; only the three reviewed engagement tables could
differ. Seven fresh UUID/disabled controls travelled through private pipes.
Before the single transaction, the caller rechecked the exact disabled main88
runtime image/mount/driver/flags, fixed target OID 30227, original backup and
current capacity. The transaction committed and a new SSH invocation verified:

- 51 public tables, 95 ledger rows, seven exact account controls, one disabled;
- zero identity bindings, application sessions and browser challenges;
- all 47 original candidate full-row digests and 92 original ledger rows intact;
- all three canonical migration-source hashes plus the distinct execution
  projection marker in the new ledger rows matched;
- original role metadata unchanged, all three own roles NOLOGIN/password NULL,
  no runtime login, app flag, provider binding or application cutover activated.

Private engagement evidence is retained root-only at
`/opt/xmartmenu/backups/identity-20261104T161702Z-3a8d70dc23a3989e/identity-engagement-source-d3c464b30093ab27.json`,
SHA256 e27f39e61927d5ca31e27f5ffa0c44ac50a380fadcbc0b4fc5f17fa2a28ae3e9.
It contains only counts/hashes/snapshot time, not account UUIDs or source Auth
records. Minimal UUID/status controls were intentionally copied to app_accounts;
raw source Auth records/passwords/tokens/contact payloads were not persisted.
The authenticated recovery backup remains intact. Full engagement reconciliation
and DB-enforced writer freeze remain necessary before data cutover. Do not apply
the foundation again; existing identity tables intentionally refuse replay.

## Candidate and additive scope

Read-only admission on 2026-11-04 found 47 business tables, no identity tables,
owner xmartmenu_owner, staging reader NOLOGIN/password NULL/limit 2 and runtime
NOLOGIN/password NULL/limit 12. Authority remains one superadmin, three
store-admins and three customers. The ledger has 92 rows ending at 20261027097000;
its real columns are version, statements[], name, created_by, idempotency_key and
rollback[]. Compatibility auth.users stores only seven original UUIDs and
cannot supply current source bans or deletion state.

The compiler checks unchanged canonical migration files with normalized-LF SHA256 pins:

|Version|Change|
|---|---|
|20261103190000|Accounts, bindings, hashed sessions; backend-only RLS/permissions|
|20261103200000|Disabled bindings and session-to-binding provenance|
|20261103210000|Single-use browser challenges and owned-session binding proof|

The native cluster has no anon role. The canonical Supabase files refer to it in
two REVOKE statements. A prepared native projection replaces only those two
statements with PUBLIC/authenticated revocation and conditional anon revocation
when that role exists. authenticated/service_role stay required before DDL.
It never creates/alters/drops a cluster role. The source files and canonical
statement provenance in the three ledger rows remain unchanged. A separate
static execution-projection SHA256 identifies the native revokes plus four-table
owned grants. Each new ledger created_by records that projection hash, and the
runner verifies it separately from all three canonical source hashes. The
postproof uses to_regrole/coalesce to deny any existing anon privilege while
allowing absence.

All three run in one transaction as xmartmenu_owner, appending only three ledger
records and resulting in 51 public tables/95 ledger rows. No historical migration
repair/replay, cluster role, password, default privilege, provider, service or app
environment change occurs. A later live probe found no table default ACLs for
xmartmenu_owner: only the existing 47 tables had runtime DML/reader SELECT.
The operation therefore explicitly grants runtime SELECT/INSERT/UPDATE/DELETE
and reader SELECT on only the four new identity tables, inside the same
transaction. It does not broaden owner defaults. Browser roles must have no
access, and RLS must be enabled. Existing identity tables cause refusal.

The canonical manifest is compared before/after DDL under table locks. The post
query excludes exactly four added tables and three ledger versions. All 47 full
business-row digests, six UUID/authority groups, two sequence definitions/states,
function bodies, old ledger records and NULL monetary values must match. Cluster
role metadata is compared inside the transaction without password verifiers.
Any failure raises before COMMIT. The eventual host caller must use ON_ERROR_STOP
and treat a lost commit acknowledgement as unknown state, never retry blindly.
The compiler includes session-local quiet logging/parameter/statistics settings
and refuses unreviewed preload/audit modules. A programmatic libpq executor must
use foundationTransaction() and await its publicPrelude before sending the
privateSql batch; sending a combined batch could log private literals before a
SET takes effect. A psql stdin executor parses the public prefix statements
before the later private statements. An ON COMMIT DROP temporary marker makes
privateSql refuse before DDL when its public transaction was not opened or was
already committed. No global logging setting is changed.

## Exact account bootstrap and proof

The compiler can leave all four tables empty or include an independently
reviewed exact-ID bootstrap in the same transaction. A source REPEATABLE READ
READ ONLY snapshot uses existing sourceConfig/publicCa pins for project
ktogbpqookfcqilqvici and parses only an explicitly supplied env file in memory.
By default it compares the entire business manifest to the candidate before
returning seven UUID/disabled booleans privately. A separately reviewed explicit
identity-foundation-only option permits drift in counts/digests of menu_events,
menu_sessions and scan_events only. All other 44 complete row digests/counts and
all six UUID/authority groups, profile/auth/tenant sets, role distribution,
order totals, functions, old ledger and sequence definitions/state stay exact.
The option requires a private evidence sink recording source/candidate counts
and hashes for those three tables, both manifest hashes and snapshot time; it
cannot silently skip recording. No raw row, account/contact value or credential
is included. Any other divergence still requires reconciliation or refresh.
Review freshness is five minutes; unknown keys, duplicate or
malformed IDs, wrong authority/profile/auth-ID digests and nonboolean state fail.

No password/hash, email, phone or provider-token/identity payload is selected or
exported. Current banned_until/deleted_at only derive a disabled boolean. An
active ban, deleted account or profiles.must_change_password yields a disabled
native account. Mandatory reset is conservatively retained as a block until
reviewed recovery; new Google login cannot bypass the old password guard.

SQL independently compares seven IDs to the candidate auth scaffold. Only
app_accounts receives rows: exact UUIDs, version zero and the review timestamp
for disabled rows. Profiles, role/tenant membership, bindings, sessions and
challenges stay unchanged. There is no email/phone matching, account upsert or
re-enabling capability. Foundation without bootstrap needs a later separately
reviewed account-only operation; this compiler refuses rerunning existing DDL.

## Next reviewed operation

This PR validates preparation only. Before apply, pin the final compiler/runner
sources and actual latest main image after official deployment. Main 88bde8a
adds OWNED_ADMIN_CATALOG_ENABLED: the future disabled admission must include it
alongside appearance/public-menu/admin-menus/orders/payments. They remain absent
or false, Google stays literal false, runtime stays NOLOGIN, and the exact Google
RO mount/private bridge must remain valid. Never reuse historical release 78a3
image pins or repeat its completed reader lease.

Create a fresh durable root-only candidate backup on existing host 49 through
the pinned healthy PG container/image/volume, without publishing a port. Reuse
custom pg_dump/pg_restore and the existing AES-256-GCM archive format. Read-only
admission confirmed Python cryptography already exists; host Node does not.
A reviewed Python AESGCM caller can use the same format without a dependency,
helper container or new paid resource. Retain a separate root-only recovery key,
authenticate the complete ciphertext, fsync files and parent directory, restore
to a newly named positively owned temporary database on the admitted cluster,
and match the entire original manifest before removing only that temporary DB.
Do not reset the candidate or rerun the persistent importer.

The backup/rehearsal caller is a separate operator; it cannot apply foundation
SQL. The reviewed backup completed on 2026-11-04 at 16:17 UTC using source
SHA256 cc9b692f82daee9d0862e8f1367b7060c36c289f0f8323ac2ff462fa9c3bf255 and canonical
manifest query SHA256 02a027f4f79ce1afdcd1d5212fdec1b38781d5766478faaede28270209dd1fb1.
The fresh root-only directory is
`/opt/xmartmenu/backups/identity-20261104T161702Z-3a8d70dc23a3989e`.
Authenticated archive SHA256 is
95df4fedb8fb3a5e38590c4a08533bfe04f20daaec92392a8ec14358b327fd0c; canonical
manifest-file SHA256 is
a71caedb653ad18358861ed280a885b25f784d937d0b382925f91f886b4d887d.
The recovery key stayed in the operator/root-only file and was never output.

The restored temporary database matched the complete 47-table manifest and all
92 original ledger entries, and was removed only after owner/OID checks.
Independent post-verification matched original database OID and full data
manifest, confirmed both SQL roles NOLOGIN/password NULL, and verified the
temporary database absent. PG event counters did not increase. No foundation
SQL, account bootstrap, source Auth capture, app flags or deploy ran. An initial
public-bootstrap syntax refusal created no stage or backup; corrected public
bootstrap AST was checked before the first actual operator execution.

Seven backup policy tests passed locally and on Linux with all PG calls mocked.
A synthetic AES-GCM roundtrip using the existing Linux cryptography package
matched the existing Node crypto archive bytes exactly. No software or helper
container was installed. The backup retains original table ACLs/owners; its
restore happens only in the newly created temporary database. Failure preserves
private backup/temporary state rather than retrying or dropping anything blindly.

The separate foundation host caller was prepared and reviewed, with recovery-key
metadata (regular root-only single-link file, mode 0400, size 65) required before
any application. It reuses the existing guarded psql stdin path; no new receipt
framework or alternate target is accepted. Its private payload is hash pinned,
and postchecking independently verifies the exact seven account controls,
51/95 table/ledger counts, zero bindings/sessions/challenges and dormant roles.
Six mocked policy tests passed locally and on Linux, including missing/wrong-size
recovery-key rejection before SQL or file-content reads. The reviewed runner
source SHA256 for the prepared native compatibility fix is
37ca34c5435ef4c747a70ad5971acea2491503e7d5999056f3f8cf23ad31391d.
Compiler SHA256 is
91e2ed9683bbbd6c3f8a0a0d2d41dc6630fd557a3b32d5a27e7edc4d00a7e1c5.
Static native execution-projection SHA256 is
bcb353494fa1d45f722a1d2be6e4881b5e86b449310bef389e5c905733148bda.
Only optional-anon handling and explicit four-table grants change executable
migration SQL; table definitions/account insertion/preservation logic remain.
Public prelude and
preserved-manifest query hashes remain a5453557... and 582e959d..., respectively.

The latest preparation CI passed five real PostgreSQL cases plus checks and E2E.
Actual main release 88bde8a/image d4e0fe28c2dab7a15b9c61bf37d7e058cde9661ab189f531ea90a84b453de05e
was healthy with readiness 200, six owned flags absent, Google false, the exact
RO Google mount/private bridge, pg driver and UID/GID 1000. A first conditional
operation then refused during the READ ONLY source-manifest comparison, before
account-control selection or any foundation transaction attempt.

The read-only diff found new engagement events: menu_events 4394 to 4666,
menu_sessions 110 to 121 and scan_events 2503 to 2514. All other 44 full-row
digests, all six critical UUID/authority groups, role distribution, order totals,
function bodies, original ledger and both sequences were identical. Those counts
are an observation, not a new accepted baseline. No gate was widened implicitly,
no source refresh/reset ran, and candidate business data stayed unchanged.
The coordinator then explicitly admitted only those three engagement tables for
identity foundation preparation/apply. This is an opt-in capture option, never
a generic source/candidate equivalence or cutover proof. It changes no DDL or
candidate data: all 47 candidate digests must still match exactly before/after
the transaction. Source account controls remain fresh within five minutes.
After a fully green CI and repeated disabled-runtime admission, the restricted
capture succeeded and wrote only three-table aggregate/hash evidence privately.
The single foundation attempt returned failure. Independent inspection proved
no COMMIT: OID 30227, 47 original tables, 92 original ledger rows, zero identity
tables, all original digests/sequence states unchanged, three roles NOLOGIN/
password NULL, zero native sessions and the original authenticated backup valid.
Read-only role inventory found anon absent, making the canonical revokes
non-executable. A subsequent default-ACL probe found zero owner table defaults,
runtime default DML false and reader default SELECT false, while all 47 existing
tables had the required grants. The earlier fixture incorrectly supplied default
grants and did not mirror the live cluster. It now uses only existing-table grants
and verifies defaults stay empty after success. The compatibility fix needs new
CI and SQL-body review;
there is no blind retry, reset, source write, login enablement or app activation.
Engagement data must be retained and fully reconciled in the final DB-enforced
writer freeze/cutover. Browser REST writes and privileged RPC/Auth triggers must
also be frozen; merely stopping the app container cannot freeze those writers.
That later barrier needs a saved exact reversal while legacy Auth proof remains
available for late linking. No such freeze or source write is part of foundation.
Off-host private R2 restore/scheduling/retention remain cutover gates.

## Existing pilot and remaining login work

The disabled pilot short-circuits before pool creation. Linking later requires
a fresh verified Google/phone identity, online provider status, a single-use
same-browser challenge and either online legacy getUser proof of the exact UUID
or a recent owned session. Conflicting owners fail. Unbound identities return
ACCOUNT_LINK_REQUIRED; nothing creates an account, changes a role or matches
email/phone. The two historical Google identities may use reviewed exact
provider-subject evidence; five email identities need valid legacy-session proof
or reviewed recovery. No automatic recovery binding is prepared here.

Native sessions are hashed, tied to their exact binding/account, enforce local
disable/version and online provider revocation, and support logout/revoke-all.
None is created by foundation. The pilot does not replace legacy route guards:
src/lib/supabase/server.ts/client.ts, password-guard, resolve-redirect, signup/
staff invitations, signout and effective-tenant/context consumers still need
native integration. Catalog writers, final writer freeze/refresh and payment
reconciliation also remain necessary before complete Supabase exit.

## Tests

Fifteen offline tests cover review rejection, source-control scope, migration pins,
no-execute defaults and generated preservation/bootstrap contracts. Five CI
PostgreSQL cases run first on a fresh service with no anon role, covering missing
public transaction, baseline rollback, post-DDL privilege failure rollback,
exact seven-account bootstrap and retry refusal. The existing identity-store
suite continues to cover browser isolation, competing bindings, revocation,
disabled accounts/bindings and session provenance. All fixtures are synthetic;
no live DB is selected and local Docker Desktop is never used.
The privilege-failure case creates a synthetic anon role only inside its failed
test transaction and proves it disappears on rollback. The success case proves
the role remains absent; no production operator contains role-creation SQL.
