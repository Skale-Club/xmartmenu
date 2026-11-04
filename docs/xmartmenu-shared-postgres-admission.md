# XmartMenu database on the existing Xmail PostgreSQL cluster

Status: the reviewed persistent import completed and was independently reconciled
on 2026-11-04 UTC. Preparation was read-only; the later import created the
XmartMenu database, dormant roles and private recovery bundle described below.
Xmail was unchanged, and the XmartMenu application remains on its prior source
until a separate, reviewed cutover.

## Completed import receipt — 2026-11-04 UTC

The reviewed import exited zero and reported `committed_and_reconciled`. Its
pre-commit and post-commit source/target proofs matched:47 full-row digests,6 ID
groups,2 sequence definitions/states,21 function bodies,92 migration-ledger
entries and221 collatable-column semantic proofs. The target has7 profiles,3
tenants,56 products,2 orders and6 order items. ICU recorded and actual version
is153.136, matching the explicitly reviewed source153.121 to target153.136
upgrade mode.

An independent read-only SSH audit confirmed the target counts, healthy cluster,
the three owned roles remain NOLOGIN with no password, superuser, CREATEDB,
CREATEROLE or REPLICATION privileges, and the ICU version is153.136. The
authenticated `archive.gcm`, its separate recovery key, and checksum were
verified in the private root-only backup bundle; the key remains available for
recovery. Xmail data and role state were unchanged. Runtime transport and
off-host backup are not configured, and application cutover remains false.

This receipt proves the one-time target import and reconciliation only. It does
not prove a restore drill, off-host recovery, scheduled backups, production
runtime connectivity, application cutover, or SQL production readiness. Do not
rerun the importer or reset the populated target; use the private receipts and
the retained recovery bundle for any separately reviewed recovery operation.

## Recorded admission — 2026-11-04 UTC

SSH used the existing agent, BatchMode and StrictHostKeyChecking for the existing
known host `root@49.13.197.250` / `skaleclub-mail`. Probes used bounded READ ONLY
SQL and emitted only counts, booleans and resource measurements. No environment
or private key was read. The first measurement returned its aggregate before a
local heredoc-delimiter error; the clean 02:49:18 UTC post-probe exited zero.

| Gate | Observed |
| --- | --- |
| PG UUID/image | `e12scyfsrp822dag7m9wwd4x`, exact cached PG17 Alpine digest `266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b` |
| Health/storage | healthy; exact persistent `postgres-data-e12scyfsrp822dag7m9wwd4x` volume, writable; zero published ports |
| PG RAM / combined swap / CPU | 512 MiB / 512 MiB / 0.75 CPU |
| PG memory current / historical peak | 268 / 357 MiB; memory.events max/OOM/OOM-kill all zero |
| Host available RAM | 1,809 MiB initial, 1,839 MiB clean post-probe |
| Host swap | 509 MiB used; three current samples without swap-out, swap-in <=64 KiB/s |
| CPU / PSI | all three current samples >=50% idle; memory PSI some/full avg60 zero |
| Disk available | 10,418 MiB on Docker filesystem |
| Connections | 6 total, 1 active including probe, max100 |
| Existing PG settings | shared_buffers128 MiB, work_mem4 MiB, maintenance_work_mem64 MiB |
| New namespace state | database `xmartmenu` and its three own roles absent |
| Global compatibility roles | `authenticated` exists and is safe NOLOGIN/NOBYPASSRLS; `service_role` absent |
| Existing Xmail | 70 public tables; runtime roles already prepared |

A subsequent bounded READ ONLY probe successfully computed the operator's generic
Xmail fingerprint:70 public tables,70 row digests and existing authenticated-role
metadata. Only those counts/boolean were returned; no row, ID or digest was printed.
This checks the real SQL syntax but does not execute the import or test a restore.

## Live source-locale comparison — execution gate remains closed

Subsequent bounded source READ ONLY queries used only the explicit existing
XmartMenu env parsed in memory, the reviewed `sourceConfig` and pinned public CA.
No credential or personal data was emitted. Source: UTF8, provider ICU (`i`),
ICU locale `en-US`, rules NULL, LC_COLLATE/LC_CTYPE `en_US.UTF-8`, recorded and
actual version `153.121`. The existing target's `en-US-x-icu`/`en-US` collation
has recorded and actual version `153.136` (908 ICU collations available).

Exact locale-version equivalence is **not claimed**. The coordinator explicitly
reviewed a new candidate-only upgrade mode `153.121` to `153.136`. It requires
`--allow-reviewed-icu-upgrade`; absence of the flag still refuses the real ICU
source. The mode accepts only UTF8/ICU/en-US/rulesNULL, source recorded=actual
`153.121`, and target en-US recorded=actual `153.136` before any CREATE. New DB
metadata must confirm ICU/en-US/rulesNULL/UTF8 and the exact target version.

No existing ICU metadata is rewritten or relabelled. The custom archive restores
all tables, indexes and unique/check/FK constraints from scratch in the new DB;
invalid/unready indexes or unvalidated FKs refuse the transaction. In addition to
the47 table digests, the source/target comparison fingerprints all index and
constraint definitions (with the same fixed search_path on both sides).

Ordering/equality is measured over every admitted collatable column, including
all text-array elements. A real READ ONLY probe found221 columns (214text and
7text[]),145 indexes and71 unique indexes. The full proof SQL ran in about1509ms
on the source, emitting only counts. Metadata identifies every covered column;
an unknown type/collation/domain/nondeterministic collation refuses the import.
The generic implementation also admits pg_catalog varchar/bpchar/name and public
citext (plus supported arrays) if present and otherwise restorable.

For each column, proofs hash native ordering with a byte-hash tiebreaker, complete
native equality classes, lower/upper outputs and value counts. A combined corpus
of all values plus their lower/upper forms is also tested with every admitted
native type present, so cross-column comparisons/citext classes are covered.
No raw value or digest is printed or placed in CI. Column metadata, native proofs,
index/constraint fingerprints and all47 row digests must match before COMMIT and
again afterward. Any mismatch rolls back the table/index/data transaction; the
new empty database/NOLOGIN roles and recoverable source backup remain for review.

These checks cover the entire current stored value corpus, not every possible
future Unicode string or arbitrary future expression. Future writes follow
ICU153.136 semantics. The version transition remains an explicit reviewed
upgrade; production flags, login, transport and cutover stay disabled. No CREATE,
restore or writable database operation was executed while preparing this mode.

The source metadata also found zero collatable index expressions. The generic
operator identifies and covers such expression result values when present (for
example lower(email)), alongside ordinary columns. A second read-only synthetic
cross-version fixture evaluated11 non-NULL mixed-case/accented/Unicode values:
ordering, native equality and casefold proofs matched between ICU153.121 and
153.136. This fixture does not replace the full-data target comparison at restore.

## Placement decision

Use a new **database**, owner and runtime roles in this already-resident cluster.
Do not place another PG512 process on the low-memory XmartMenu host. This creates
no paid resource and does not borrow the Xmail database/schema. It shares cluster
memory, disk, administrator custody and failure domain, which the coordinator
must accept before execution. No existing candidate or volume may be reset.

Admission in the operator repeats immediately before creation: host >=1536 MiB
available, swap <=512 MiB, no swap-out, <=64 KiB/s swap-in, >=50% CPU idle, low PSI,
>=3 GiB free on disk-backed /tmp,/opt,/var/lib/docker. The PG cgroup must be
<=320 MiB current, <=384 MiB historical peak and have no max/OOM events. There
must be <=40 connections and max_connections>=80. Resource limits are never
lowered to force admission. A source-locale/version gate must also pass before
any target roles/database are created. Default mode requires exact UTF8/libc
equivalence; the explicit reviewed ICU mode requires the precise source/target
version pair above and matching current-data semantic proofs. All other upgrades
and providers fail closed.

Dump/crypto phases add at most two128 MiB helper/client cgroups. Restore uses the
existing PG512 cgroup plus one128 MiB helper, with the restoring session capped
at work_mem2 MiB and maintenance_work_mem16 MiB. No extra PostgreSQL process is
started. These observations admit a bounded snapshot import, not representative
production query load. Recheck warm runtime capacity before any actual cutover.

## Prepared operator and review boundary

Files:

- `scripts/ops/import-xmartmenu-private-candidate.mjs`: local snapshot holder and
  strict source/CA/dependency guards, remote static-code checksum verification,
  secret-filtered SSH environment and bounded source-release handshake.
- `scripts/ops/import-xmartmenu-private-candidate.sh`: exact cluster/volume/limits,
  fresh admission, new-name/empty-database guards, durable bundle, transaction,
  pre/post-COMMIT reconciliation and existing-Xmail fingerprint comparison.
- `scripts/ops/import-xmartmenu-private-candidate.helper.mjs`: existing reviewed
  source manifest/crypto/TOC reuse, database-local compatibility scaffold and
  strict source locale SQL. Existing source protocol/crypto files are unchanged.
- `scripts/ops/import-xmartmenu-private-candidate.test.mjs`: offline guards only.

Default and `--plan` do no I/O beyond loading code. The offline unit command is:

```text
node --test scripts/ops/import-xmartmenu-private-candidate.test.mjs
```

After coordinator review only, transfer the runner/helper plus the unchanged
`xmartmenu-source-protocol.mjs` and `xmartmenu-archive-crypto.mjs` into
`/opt/xmartmenu/persistent-import` (root0700; code root0600). The controller checks
all four exact SHA256 values before opening the source. For this explicitly
reviewed ICU source, the invocation is:

```text
node scripts/ops/import-xmartmenu-private-candidate.mjs --execute-reviewed-import --source-env <explicit-existing-source-env-path> --allow-reviewed-icu-upgrade
```

The explicit source env is parsed only in memory during reviewed execution;
ambient production aliases and secrets are not inherited by SSH. This work did
not open it. Do not put a source connection URL in arguments, logs or Git.

## Target, authority and failure behavior

The cluster-admin session may create only `xmartmenu_owner`, `xmartmenu_runtime`,
`xmartmenu_staging_reader` and database `xmartmenu`. All three roles stay NOLOGIN.
Owner is not superuser/CREATEDB/CREATEROLE/BYPASSRLS. Runtime/staging are separate
backend-only BYPASSRLS roles, with connection limits12/2, no role memberships,
and database-local DML/SELECT grants; staging defaults read-only. No password or
runtime connection is activated. Current five pools are max2 each per replica;
12 runtime slots are not approval to run multiple unbudgeted replicas.

Existing `authenticated`/`service_role` attributes or grants are never changed.
A missing service_role may be created NOLOGIN/NOBYPASSRLS without memberships or
Xmail grants. Auth is a target-only UUID/FK scaffold with NULL-returning helpers;
it does not migrate login, link by email/phone or copy provider sessions/hashes.

CREATE DATABASE cannot run inside the role-creation transaction. Partial roles
or an empty database can therefore survive failure. Initial guards refuse any
existing own role/database, including a prior incomplete attempt. Never remove,
reset or automatically retry it; inspect the private receipts and reconcile it.
A host flock plus a database transaction lock prevents duplicate own imports.
The Xmail database receives only two bounded read-only fingerprint queries.

Restore runs SET ROLE xmartmenu_owner in one transaction, keeps object/COPY/RPC
bodies unchanged and strips only the four exact timeout-disabling pg_restore
preamble SETs. The47 complete row digests,6 authority groups,2 sequence
states/definitions, function definitions, ledger and NULL-preserving order totals
must match before COMMIT, together with all native text semantic proofs and
index/constraint definitions. The same proofs are rechecked in a fresh session after
COMMIT; existing Xmail's70 row digests and authenticated-role attributes must
also match before reporting success. Source sequences still require a final
writer freeze: an exported MVCC snapshot does not freeze sequence state.

## Recovery and remaining gates

Before any target creation, retain a new root0700 bundle under
`/opt/xmartmenu/backups/import-<nonce>.<random>/` with authenticated `archive.gcm`
and its independent `archive.key` (both0400), checksum and private source manifest.
The copied ciphertext and key are read back, and filesystem sync precedes target
creation. Target pending/commit-ack/final receipts distinguish uncertain commits.
The key is deliberately retained for real recovery, unlike the ephemeral rehearsal
key. It must later be escrowed independently with any off-host archive; copying
ciphertext alone without its key is not a complete recovery mechanism.

Transient plaintext restore SQL/UUID compatibility material and private diagnostic
logs exist only in a root0700 nonce directory on disk-backed /tmp, removed by the
scoped trap. SIGKILL/host failure can leave scratch requiring operator review.
Cleanup removes only nonce-labelled helper/client containers and scratch; never
the persistent PG/volume, target database/roles or any backup/key. No old backup
or retention policy is pruned. Off-host authenticated recovery, scheduled backups,
R2 dedicated private storage, retention/key escrow and WAL/PITR remain separate
gates. This import is not a new off-host restore proof.

Runtime private transport remains unconfigured. A restricted SSH stdio bridge
from an internal Xmart sidecar can connect to the existing container without
publishing a PG port or restarting it. It needs separately reviewed dedicated
key/ForceCommand/health/reconnect operators; none are created here. No existing
WireGuard or persistent tunnel was proven. Source remains authoritative; all
owned-data/auth feature flags and payment consumers remain unchanged. Final
writer freeze/refresh, Auth acceptance, network/runtime load tests and backup
recovery are still required for application cutover.
