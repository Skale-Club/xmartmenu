# Xmartmenu identity foundation preparation

This change prepares private SQL; it cannot execute a production operation.
The CLI accepts only the default/explicit offline plan. Source capture is an
exported function for a future reviewed caller, never a CLI that prints accounts.
No source capture, foundation DDL, account bootstrap or activation ran in
preparation. A separately reviewed fresh backup/temporary restore then completed
as recorded below; the foundation compiler still has no apply entrypoint.

## Candidate and additive scope

Read-only admission on 2026-11-04 found 47 business tables, no identity tables,
owner xmartmenu_owner, staging reader NOLOGIN/password NULL/limit 2 and runtime
NOLOGIN/password NULL/limit 12. Authority remains one superadmin, three
store-admins and three customers. The ledger has 92 rows ending at 20261027097000;
its real columns are version, statements[], name, created_by, idempotency_key and
rollback[]. Compatibility auth.users stores only seven original UUIDs and
cannot supply current source bans or deletion state.

The compiler checks normalized-LF SHA256 pins and uses unchanged migration bodies:

|Version|Change|
|---|---|
|20261103190000|Accounts, bindings, hashed sessions; backend-only RLS/permissions|
|20261103200000|Disabled bindings and session-to-binding provenance|
|20261103210000|Single-use browser challenges and owned-session binding proof|

All three run in one transaction as xmartmenu_owner, appending only three ledger
records and resulting in 51 public tables/95 ledger rows. No historical migration
repair/replay, cluster role, password, default privilege, provider, service or app
environment change occurs. New-table runtime DML/reader SELECT must come from
the previously reviewed owner default privileges. Browser roles must have no
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
It compares the entire business manifest to the candidate before returning
seven UUID/disabled booleans privately. Any divergence requires reconciliation
or refresh first. Review freshness is five minutes; unknown keys, duplicate or
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

The foundation execution caller remains separate and unimplemented. Source
capture, latest release admission, final hashes and review of the actual private
SQL are still required before one foundation application. Off-host private R2
restore/scheduling/retention remain cutover gates.

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

Eight offline tests cover review rejection, source-control scope, migration pins,
no-execute defaults and generated preservation/bootstrap contracts. Five CI
PostgreSQL cases cover missing public transaction, baseline rollback, post-DDL privilege failure rollback,
exact seven-account bootstrap and retry refusal. The existing identity-store
suite continues to cover browser isolation, competing bindings, revocation,
disabled accounts/bindings and session provenance. All fixtures are synthetic;
no live DB is selected and local Docker Desktop is never used.
