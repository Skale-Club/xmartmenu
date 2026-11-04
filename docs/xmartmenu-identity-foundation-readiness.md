# Xmartmenu identity foundation preparation

This change prepares private SQL; it cannot execute a production operation.
The CLI accepts only the default/explicit offline plan. Source capture is an
exported function for a future reviewed caller, never a CLI that prints accounts.
No source capture, backup, DDL, account bootstrap or activation ran in preparation.

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

The backup/rehearsal/apply caller is deliberately not included here. Its review,
capacity admission, source capture and final source hashes remain required
before one application. The earlier import backup does not replace this fresh
proof. Off-host private R2 restore/scheduling/retention remain cutover gates.

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

Seven offline tests cover review rejection, source-control scope, migration pins,
no-execute defaults and generated preservation/bootstrap contracts. Four CI
PostgreSQL cases cover baseline rollback, post-DDL privilege failure rollback,
exact seven-account bootstrap and retry refusal. The existing identity-store
suite continues to cover browser isolation, competing bindings, revocation,
disabled accounts/bindings and session provenance. All fixtures are synthetic;
no live DB is selected and local Docker Desktop is never used.
