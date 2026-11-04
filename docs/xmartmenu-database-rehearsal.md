# Temporary XmartMenu database rehearsal — prepared, unexecuted

This protocol restores the **application database**, not login, into a new
temporary PostgreSQL container on the existing Xmail server. It does not create
a persistent XmartMenu production database. Persistent placement on the current
XmartMenu host remains denied by
[the capacity inventory](xmartmenu-postgres-host-admission.md).

No real dump, encrypted archive transfer, target container, host tmpfs mount,
source credential in CI or production DDL has been executed by this increment.
The coordinator must review this exact revision and repeat capacity checks before
execution. Default modes perform no operational work:

```text
node scripts/ops/xmartmenu-database-rehearsal.mjs --plan
bash scripts/ops/xmartmenu-database-rehearsal.sh --plan
```

## Source and snapshot contract

The local Node orchestrator reads only the explicitly supplied existing
XmartMenu `.env.local`, parses it in memory, and pins project
`ktogbpqookfcqilqvici`. It ignores ambient production aliases. Direct/session
port 5432, exact source host/user/project/database and restricted URL options
are mandatory. The official public CA has a fixed X509 fingerprint and validity
check; both the Node holder and libpq dump use full TLS/hostname verification.
No insecure TLS override or arbitrary connection option is accepted.

One REPEATABLE READ READ ONLY connection exports the snapshot. The same
transaction supplies all 47 table counts and full-row digests, six critical
UUID/authority groups, profile roles, NULL-preserving order totals, function-body
fingerprint, full migration-ledger fingerprint and minimal auth UUID list. The
remote pg_dump imports exactly that exported snapshot. The holder explicitly
rolls back only after the remote dump has completed and the encrypted archive
has authenticated; a 180-second source watchdog and server idle/statement/lock
deadlines protect failure paths. Restoration is forbidden until source release
is acknowledged.

The source admission also verifies SELECT coverage and absence of RLS filtering,
the reviewed four public→auth.users FKs, policy role names and the 21 reviewed
public functions' dependency class. A changed table/authority/ledger baseline,
unreviewed sequence, unexpected function dependency or external FK is a refusal,
not permission to update the baseline automatically. The local twelve missing
historical ledger entries are not replayed or repaired.

The source has exactly two BIGINT sequences: `ai_usage_events_id_seq` owned by
`public.ai_usage_events.id`, and `audit_events_id_seq` owned by
`public.audit_events.id`. Both use ordinary serial ownership, start/minimum 1,
increment/cache 1, maximum 9223372036854775807 and no cycle. Only those two names
and their exact definitions/ownership are admitted. The TOC preserves each
SEQUENCE, SEQUENCE OWNED BY and SEQUENCE SET entry. The manifesto compares
`last_value` and `is_called`, including the never-called state; no source nextval
or setval is executed. Sequence state is not MVCC-snapshot-consistent: a concurrent
advance may make this rehearsal refuse reconciliation, and final production
cutover requires a writer freeze. Success explicitly reports that limitation.

All public integration rows are preserved as opaque app data, including private
configuration or encrypted credentials when present. They remain only inside
the encrypted temporary archive and isolated target. Do not sanitize this backup:
its complete row digests must match. A future DEVELOPMENT copy needs a separate
sanitization gate before any app/worker startup. This run starts no application,
provider SDK, billing or notification worker and cannot send Stripe/other effects.

No private Auth session, refresh-token, provider-token, password-hash or user
payload table is exported. Only seven original `auth.users.id` UUIDs cross the
private control channel. The temporary scaffold is `auth.users(id)` plus
NULL-returning `auth.uid()` and `auth.role()`, with public execution revoked and
`authenticated`/`service_role` NOLOGIN/NOBYPASSRLS. It exists solely for FK/helper
compatibility. There is no email/phone matching, reassociation or migrated login.

## Host and resource budget

The runner accepts no host/image/database/owner override. SSH uses only the
existing agent and known-host verification for `root@49.13.197.250`; the remote
script also pins hostname `skaleclub-mail` and two CPUs. The PG17 image is
`sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b`.
The Node-only helper uses the already cached Xmail image
`sha256:93c4f3284e452b518dfd7f7363152976cd1d1e3d1a28f76814b8a0ea9797b58d`,
overriding its entrypoint; no Xmail app or runtime environment is started/copied.
All images use `--pull=never` and are inspected before work.

Admission requires at least 1,536 MiB MemAvailable, at most 512 MiB swap used,
no active swap-out, at most 64 KiB/s current swap-in, at least 50% idle CPU in
three current samples, memory PSI avg60 some≤0.10% / full≤0.05%, and at least
2 GiB free on each relevant filesystem. The lifetime-average vmstat row is
ignored. Recheck before starting the target. A failed gate aborts; limits are
not tuned during execution to force acceptance.

| Phase | Concurrent run containers | Separate host allocation | Conservative total |
| --- | --- | --- | --- |
| Packet admission | Node helper128 MiB | tmpfs64 MiB | 192 MiB |
| Source dump/encryption | source client128 + Node helper128 MiB | tmpfs64 MiB | 320 MiB |
| TOC validation | offline client128 + Node helper128 MiB | tmpfs64 MiB | 320 MiB |
| Target initialization | target256 MiB | tmpfs64 MiB | 320 MiB |
| Restore / final comparison | target256 + Node helper128 MiB | tmpfs64 MiB | 448 MiB |

The target's data128 MiB/socket8 MiB/tmp8 MiB tmpfs allocations and its
PostgreSQL, pg_restore and psql processes are **inside its 256 MiB cgroup**;
they are not additional free RAM. The encrypted-archive host tmpfs is separately
counted at its full64 MiB limit even though helper writes may also be charged
to its cgroup. Leave additional margin for host Docker/SSH/shell processes and
the required host reserve. No separate 128 MiB PG client is created once the
target exists: pg_restore and psql run via docker exec inside that target.
The source and offline clients have completed before target initialization.

All run containers have hard RAM/combined-swap/CPU/PID limits, dropped
capabilities, no-new-privileges, read-only roots and disabled Docker logging.
The target has network none, no ports, Unix-socket-only PostgreSQL and no
persistent volume. Source connectivity exists only in the bounded dump client.
The provider source is read-only. The helper and offline TOC client have
network none. Existing Xmail's persistent candidate/volumes/backups are excluded.

## Private archive and restore

Credentials go through SSH stdin and a protected in-memory PG* environment,
then Docker `--env-file /dev/stdin`; no connection URL/password is put in argv
or a standalone env file. The short-lived dump client's Docker environment
metadata exists only until it is removed. Other local ambient secrets are not
inherited by SSH children.

The archive uses AES-256-GCM with a fresh random in-memory key and nonce. The key
enters the crypto helper through stdin, never argv, environment or a permanent
file. Only authenticated ciphertext is stored in a private root-owned host
tmpfs. The ciphertext file is exclusive-created0600, then read-only0400. An
encrypted archive above32 MiB is refused; the host tmpfs is capped64 MiB.
Before each decryption-to-consumer, the helper authenticates the entire file
while discarding plaintext; only then does a second pass emit bytes from the
same opened file descriptor. Tampering/wrong keys produce no consumer plaintext.

TOC generation precedes server startup. The TOC validator requires the exact47
public table names and both selected schemas, rejects hosted/global/provider
objects, and comments out exactly one CREATE SCHEMA public entry. It does not
skip other failing entries or alter object definitions/COPY data. Unexpected
event triggers or extension objects require another explicit code review.

The target-only auth scaffold is created first. Authenticated archive bytes then
flow into pg_restore running inside the target. Its generated SQL streams into
psql with ON_ERROR_STOP inside one explicit bounded transaction. Only the four
exact pg_restore preamble statements that disable statement/lock/transaction/
idle timeouts are removed, with exactly four matches required before COMMIT.
Function/COPY bodies are untouched and SQL is never saved as plaintext. Server
deadlines remain 210s transaction /180s statement /2s lock /30s idle. All CLI
phases also have deadlines; no restore error is ignored.

A fresh read-only target session recomputes the same canonical manifest. Every
public row multiset, critical UUID/role/tenant/order association, original NULL
currency/total, function body and ledger record must match. Only a sanitized
aggregate report is eligible for output.

## Exact code transfer and execution gate

Only these three reviewed static LF files belong on the remote host:

- `xmartmenu-database-rehearsal.sh`
- `xmartmenu-archive-crypto.mjs`
- `xmartmenu-source-protocol.mjs`

Use root-owned0700 `/opt/xmartmenu/rehearsal`, root-owned0600 regular nonsymlink
files. The orchestrator compares all three remote SHA256 values to the local
reviewed bytes **before opening a source connection**. Do not copy `.env.local`,
private data, dumps or keys with the code. No transfer/start is performed by
default plans. After independent review and a freshly admitted host window,
the coordinator may run locally:

```text
node scripts/ops/xmartmenu-database-rehearsal.mjs --execute-reviewed-rehearsal --source-env C:\Users\Vanildo\Dev\xmartmenu\.env.local
```

That is an explicit execution command, not a step already performed here.

## Cleanup and validation evidence

SIGINT/TERM/HUP, source watchdog, CLI deadlines and server transaction deadlines
cover interruption. Cleanup can remove only the three exact per-run names whose
labels still match its nonce, unmount its exact private tmpfs and remove its now
empty mktemp directory. It never enumerates/deletes volumes, backups or any
existing candidate. Success is withheld until matching run containers and the
temporary directory are positively absent. No raw row, UUID, digest, key,
ciphertext, database error or log is returned.

Local offline tests cover both default plans and override refusal; source/CA/
packet allowlists; authority/NULL/digest mismatch; UUID-only compatibility;
AES-GCM roundtrip/tamper-before-output and size refusal; strict TOC; exact timeout
filter preserving COPY; and cleanup scope. A separate disposable CI PostgreSQL
fixture uses **only synthetic data** to exercise the manifest SQL and detect
integration-row, authority, ledger/function and NULL-currency changes. No source
credential, SSH secret, customer data, archive or private digest is configured
in CI or uploaded as an artifact. No local database/build was run.
