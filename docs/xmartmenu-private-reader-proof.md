# Private SQL reader proof on the disabled Xmartmenu release

The reviewed proof executed once on2026-11-04 against main release
78a3cd545c4b6c3f31c01e7cc244c06154d4f506, after its official CI/deployment and
actual image/driver/mount/flag checks. It verified real private PostgreSQL reads
from the app container through the existing SSH transport. It did not activate
SQL runtime login, Google/owned app flags, write application data, contact a
payment/identity provider or perform an authenticated public-user test.

## Executed evidence

|Reviewed artifact|SHA256|
|---|---|
|Actual app image ID|`df2d814c67b0049a26e5cf76a4909fdce7434d9ee028219e8ebc0fae2596f267`|
|Private controller|`a46ebd73a597fe5c3d9a20d84e385bd0581850d6eae88ad41a4bab3c32c2cda5`|
|Lease/watchdog source|`43aa404f7e0790b6e8465475042b3ee6ed3f57fa5c805d330b6e3c676e69130b`|
|Public compiled reader bundle|`9a2a8df9dbe0ac4de9f7d32d23406adc5508c9f62e55d4f483e2429f7f6bd851`|

The builder compared all10 application-source dependencies with the image
commit's Git blobs, as well as the dependency lock. The public helper entry and
artifact have separate hashes; no credential was present during construction.
It uses the real unchanged public-menu, orders and payment-checkout read adapters
with an injected PostgreSQL query, without changing any app environment flag.

Seventeen local tests passed:8 lease/cleanup policy,6 controller/channel/Python
bootstrap and3 client authority/read-only tests. The8 owner tests passed on real
Linux with SQL mocked. Nine additional public fixtures passed in the actual
Linux app Node24/pg8.20 runtime: fragmented/bounded private frames, EOF/malformed
data, output allowlist, no-execute gates, fixed target/URI refusal, and READ ONLY
rollback/close. Those fixtures used no actual SQL or role mutation.

The real proof completed25 SELECTs inside one REPEATABLE READ READ ONLY snapshot.
Counts matched the preserved candidate:7 profiles,3 tenants,56 products,2 orders,
6 order items. All three real read adapters passed. The controlled reader
transaction rolled back and its connection ended before revocation.

The independent post-check on49 verified reader NOLOGIN, passwordNULL, limit2,
default_transaction_read_only on,0 sessions; runtime NOLOGIN/limit12 remained.
PG was healthy with no public port, and the reviewed host wrapper hash remained
unchanged. Private transport health passed afterward at18MiB. No password,
verifier, personal row, email, UUID, URL credential or raw SQL diagnostic was
emitted to the coordinator/tool output.

## Scope and secret channel

The sole existing role is`xmartmenu_staging_reader`, with its existing BYPASSRLS,
SELECT grants, limit2 and default read-only setting. Preflight refuses any role
membership, public-schema CREATE privilege, table INSERT/UPDATE/DELETE/TRUNCATE,
active reader session, non-NULL old password or unsafe role attribute. Runtime
must remain NOLOGIN/limit12. Fixed container/image/volume/network pins are checked
again before every owner SQL call; no alternate target or role is accepted.

The controller first verifies the exact disabled image, app bridge, UID/GID1000,
pg driver, readable ADC and exact Google RO mount. Only then can it start the
owner child on49. A256-bit random credential is created only in memory, with a
fresh SCRAM-SHA-256 verifier and VALID UNTIL at most240s ahead. Native role
metadata temporarily changes; application data does not. No user/account,
database, privilege grant, service, container or paid resource is created.

Only programmatic pg configuration is accepted:10.0.4.1:15432, database xmartmenu,
that staging role and ssl false over the reviewed encrypted SSH transport.
No connection URI or environment password/SQL alias is used. Password and public
helper bytes travel through controller-owned SSH/Docker stdin pipes. The only
remote argv is public bootstrap code. The compiled helper is hash checked and
loaded virtually; no helper/credential is written in the app container.

The private child emits a binary credential frame to the controller pipe.
**Never invoke `--serve-private-lease` directly in a terminal/tool that logs its
stdout**, never tee/debug the pipe, and never print child stderr or packets.
Normal entrypoints default to offline plans. The controller outputs only an
allowlisted aggregate of counts/booleans. Unknown fields, targets, malformed
frames and wrong source/image hashes fail before use. The client enforces READ
ONLY and rejects RPC, locking/multi-statement/mutating queries; it invokes only
the reviewed read methods. Default-read-only alone is not treated as a general
restriction on arbitrary SQL users: this is a sealed, operator-owned proof.

Owner SQL receives only a SCRAM verifier through stdin. Session-local logging
and utility-statistics settings prevent credential text from being recorded;
they never alter cluster-wide settings. Unknown audit/preload modules refuse
before generation. The exact quiet prefix was validated in a READ ONLY
transaction before the lease. Raw psql errors are captured and never surfaced.

## Cleanup and bounded failure behavior

An independent, detached cleanup child is ready before LOGIN is granted. It
inherits the exclusive lease-lock FD and watches owner pipe EOF/deadline. It
sets only the fixed reader NOLOGIN/PASSWORD NULL, terminates only sessions in
xmartmenu with this role and this proof's nonce/application_name, and verifies
no reader sessions plus runtime NOLOGIN. It settles for20s to close the bounded
late-grant-subprocess race. It never retries the LOGIN grant. Role attributes,
grants/default settings and other app/cluster roles are preserved. The finite
VALID UNTIL may remain as an operational record after revocation; NOLOGIN and
passwordNULL are independently verified before completion.

The controller always closes the owner channel in finally and requires its
cleanup acknowledgement. A lost acknowledgement, unknown state or failed
cleanup is not success: inspect/recover the fixed reader before another attempt.
An explicit hash-gated recovery mode is available for that same reader/nonce;
it does not widen privileges. Password expiry is an upper bound for new logins,
not a replacement for revocation or terminating existing proof sessions.

The watchdog/lock is a temporary process, not a new service or recurring job.
No credential is persisted in a receipt, app config, shell history or artifact.
The default plan and source artifacts are safe to inspect offline.

## Reproduction after a separately reviewed future request

```bash
node scripts/ops/build-xmartmenu-private-reader.mjs --plan
node scripts/ops/xmartmenu-private-reader-controller.mjs --plan
python3 -B scripts/ops/xmartmenu-private-reader-lease.py --plan
```

Build a new public artifact against the exact validated app commit, record its
hash and the final controller/lease hashes, and use only the controller's
explicit reviewed mode. Recheck source hashes rather than copying historical
hashes blindly. A missing pg driver/mount, changed image or changed role stops
before any new credential. Do not rerun the old importer, create a helper
container, start local Docker Desktop or modify production flags to reproduce.

This proof establishes private authenticated SQL and selected adapter reads.
It is not complete Supabase exit, application login migration, native business
writes, source-freeze/final refresh, off-host backup/restore or cutover acceptance.
Those remaining business/auth migrations have separate ownership and gates.

Primary references:[node-postgres programmatic configuration](https://node-postgres.com/features/connecting),
[PostgreSQL ALTER ROLE](https://www.postgresql.org/docs/17/sql-alterrole.html),
[transaction defaults](https://www.postgresql.org/docs/17/runtime-config-client.html),
and[logging settings](https://www.postgresql.org/docs/17/runtime-config-logging.html).
