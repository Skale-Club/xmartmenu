# Private Xmartmenu PostgreSQL transport preparation

Status on2026-11-04: transport-only installation completed after technical review,
then the owned client unit was stopped when the sustained-connection test
found the installed nc idle timeout. The reviewed host-socket replacement was
installed using the digest-guarded upgrade and the client is now **healthy**.
The full path passed12 simultaneous protocol-only channels held20s, denial of
the13th and SSH command/forwarding denials. Do not restore/start the old nc
wrapper for production use. The app still reads its prior data source; SQL
runtime remains NOLOGIN/limit12 and app flags remain false. No SQL password,
app variable, Docker network, PG limit, data or deployment was changed.

The dedicated client key was created only on188; only its normalized public key
was copied to49. Operator code never read/output the private key. The first
installation's source/receipts remain verified, with37 existing users' effective
SSH policies unchanged. Basic protocol health passed at12MiB client cgroup use.
The candidate and retained import backup remain intact. This completes dormant
transport readiness only; it does not activate or prove SQL login/app cutover.

## Chosen path

Use the existing app host188.245.112.3 and PG host49.13.197.250. No VM, image,
database process, public PostgreSQL port or paid resource is required. Python3.12,
OpenSSH, sudo and systemd255 are already installed; `/usr/bin/nc` already exists
in the exact PostgreSQL image. Existing SMTP and Google services are untouched.

One unprivileged host Python service accepts valid host addresses from
10.0.4.0/24 at10.0.4.1:15432, excluding the gateway, network and broadcast
addresses, on the app's own existing bridge
`gmaayluj11x1m6j7baogonfn`. This is not the shared `coolify` network. Its full
network ID is9618654f72854308768936727d24ecd948decaa235eaf51a163d845958f47c37;
the host bridge device is`br-9618654f7285`. Startup admission pins the ID,
subnet/gateway and one running app or two during Coolify rolling deployment.
Both containers must have this exact app UUID/Compose resource labels, a valid
Xmartmenu repository image with a commit SHA tag, immutable image ID and unique
valid addresses within the subnet. An old10.0.4.2 and new10.0.4.3 can coexist;
the new address can remain after rollout. `BindsTo` stops the service
if that exact bridge device disappears. A bridge/subnet replacement needs review
and regenerated pins; it cannot silently broaden the listener. All members of
this isolated app network can reach the transport, so its membership is trusted
to the existing Docker root administrator. The bridge makes no claim to prove
the calling container's identity from caller-supplied metadata. Separate SQL
credentials/privileges enforce database identity. Other Docker networks and the
public host interfaces are excluded.

Each admitted client gets a dedicated SSH stdio channel. There is no OpenSSH
`-L`, `-R`, `-W`, agent, ControlMaster or forwarding exception. Client config and
agent inheritance are disabled. The dedicated key's private part will be created
only on188 and remain there, readable only by`xmartmenu-pg-client`. It is never
placed in a container, repository, bundle, environment or coordinator output.

Choose a dedicated SSH user`xmartmenu-pg-ssh`, instead of a root authorized key. It has
no Docker group, password, writable home/authorized_keys, or other permitted
sudo command. Its dedicated root-owned AuthorizedKeysFile is
`/etc/ssh/authorized_keys/xmartmenu-pg-ssh`. The key line combines`restrict`, exact`from="188.245.112.3"` and
a forced `/usr/bin/sudo -n -- /usr/local/libexec/xmartmenu-pg-stdio.py`.
The sudo policy permits **only that script with no arguments** (`""` in sudoers),
preserving only the two required SSH request variables. Installed sudo1.9.15p5
accepted this policy via stdin-only`visudo -c -f -`; nothing was installed.

The root-owned isolated-Python wrapper rejects nonempty SSH_ORIGINAL_COMMAND,
any argument, a wrong source/server address/SSH port, and unsafe root-owned
script/lock paths. It acquires one of12 precreated root-only flock slots. Every
connection inspects the exact PG container, pins its immutable current container
ID, image, healthy state, resource limits and named writable data volume, and
refuses published ports/host networking. The **first installed** version executed:

```text
docker exec -i -u postgres <validated immutable container ID> /usr/bin/nc -w 5 127.0.0.1 5432
```

That version is now stopped. Isolated Popen tests with stdin kept open proved
the installed BusyBox nc and the same direct SSH channel both return EOF after
approximately10.5s of idle following SSLRequest, with exit0. No global Python,
Node or subprocess timeout was involved. The first6s-before-data/8s-after-data
checks were insufficient. PG authentication_timeout is60s; sustained channels
were only15s old, so it did not cause those early closures. No claim of complete
sustained12-channel readiness is made for the first version.

The replacement source uses only existing host Python on49. It reads a selective
Docker Go-template JSON snapshot (no Config.Env/owner credentials), validates
network`coolify` ID
`3d6a1305106acfa0c120c280e047ecdc3c3016b83ec20fcce361d2db6da4d078`, bridge
IPv4 subnet10.0.1.0/24/gateway10.0.1.1, and derives the current private IPv4 of
that exact container. Its only destination is that address at literal5432;
there is no DNS, argument/environment destination or stale container IP pin.
`socket.create_connection(timeout=5)` is followed by a repeat validation of the
same immutable container ID, host PID and current address. Buffers are32KiB,
chunks16KiB and both directions apply backpressure. There is no idle deadline;
only actual input EOF starts a10s final-response grace. No Dockerexec/nc process
persists. The wrapper drops supplementary groups and all real/effective/saved
UID/GID values irreversibly to the dedicated SSH user, sets NoNewPrivs and verifies
all capability sets are zero before sending READY or copying any PG bytes.
The root-only flock FD remains open through that drop until cleanup.

Container UUID`e12scyfsrp822dag7m9wwd4x`, image
`sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b`,
volume`postgres-data-e12scyfsrp822dag7m9wwd4x`, memory/combined swap512MiB and
CPU0.75 are exact pins. Container IP is never pinned or used, so a normal PG
container IP change does not require a stale PermitOpen edit. No Docker shell,
SQL command, user-specified executable or argument can reach the wrapper.

The wrapper is a narrow root execution surface that must remain reviewed and
root-owned. It exposes TCP to the existing cluster, not database-level identity:
PostgreSQL authentication and the isolated Xmartmenu runtime role still enforce
database privileges. It changes no cluster auth/global role or pg_hba setting.

## Capacity and connection behavior

The service unit proposes MemoryHigh96MiB, MemoryMax128MiB, no service swap,
TasksMax32, CPUQuota50%, LimitNOFILE256 and bounded stream buffers/chunks.
Twelve total channels include the heartbeat; at most three handshakes run at
once to avoid adding a12-way burst to the existing sshd MaxStartups10:30:100.
Queue plus handshake is bounded to5s; additional clients close immediately.
Both directions await drain, use32KiB stream/high-water bounds and16KiB chunks.
Half-close permits the response to finish, with a10s final drain bound. Remote
EOF closes the client immediately. Stop/restart cancels sessions and reaps SSH.
No PostgreSQL byte, transaction or request is retried/replayed. A later new
connection makes a fresh SSH channel; a mid-transaction failure reaches the app
as a connection error, preserving existing reconciliation/idempotency duties.

Every30s when a slot is available, health sends only the8-byte PostgreSQL
SSLRequest and accepts its single N/S reply. There is no SQL, authentication or
write, health HTTP endpoint, public listener or automatic app activation. SSH
keepalive is5s/count1 in both directions. The prepared dedicated-user server
Match block also disables password/keyboard-interactive auth, forwarding, PTY
and user rc and fixes the command/AuthorizedKeysFile. Existing server
ClientAliveInterval was0, which could otherwise retain remote slots during a
network partition. The new fragment must be included **at the end** of the main
sshd config, avoiding Match-context bleed into existing global directives.
The complete proposed configuration was parsed from memory via stdin-only
`sshd -T -f /dev/stdin`; the dedicated settings were exact and the entire
effective root-user policy matched before/after. Nothing was installed/reloaded.
Health logs contain only a boolean and active count.

128MiB is the **client** process group budget, not the PG memory budget or a
measurement of all remote sshd/Python/Docker helpers. Remote helpers are bounded
to12 by locks, but live12-channel memory/CPU and cleanup under disconnect remain
required proofs before cutover. If128MiB cannot sustain this test, stop and
review the budget; never enlarge or resize silently. Existing PG limits remain
unchanged. The runtime role currently remains NOLOGIN with CONNECTION LIMIT12.

Admission below concerns this lightweight dormant bridge, not approval of a
new database/restore or the future full production query workload. It requires
current available RAM>=512MiB on188 and>=1024MiB on49, low PSI, >=50% sampled
idle, no swap-out, <=64KiB/s swap-in, >=512MiB disk, PG current<=384MiB,
zero historical OOM and no new cap/OOM events during the server check. Historical
swap use and memory cap hits are reported, never erased or confused with OOM.

Three consecutive one-second samples ran read-only using the actual operator's
metrics/capacity and network/container guard functions loaded in memory:

|2026-11-04 observation|App188|PG host49|
|---|---:|---:|
|Available RAM MiB|3032|1787|
|Swap already used MiB|2804|500|
|Disk free MiB|39212|10362|
|Sample idle %|86.1/85.8/82.0|94.9/84.8/84.8|
|Swap-in/out each sample KiB/s|0/0|0/0|
|Memory PSI some/full avg60|0/0|0/0|

PG was healthy,209MiB current,512MiB historical peak,`memory.events max=653`,
OOM/OOM-kill0; the peak/cap hits followed the import and were **not reset**.
Another bounded READ ONLY transaction found6/100 connections, database present
and runtime NOLOGIN/connection-limit12. No public PG ports exist. The old strict
creation/import gate (peak<=384MiB and zero max-events) no longer passes; the
coordinator explicitly separated that historical gate from dormant bridge
preparation. This is not evidence that production load fits the512MiB database.

The live app was healthy on its pinned network/IP;15432 was unused. Both new
account names and transport units were absent. Effective server sshd: PAM on,
Banner/ForceCommand none, PermitUserEnvironment no, standard authorized_keys,
no global `/etc/ssh/sshrc`. A read-only test of the exact installed nc kept its
connection idle6s and then got a valid SSLRequest reply, proving `-w5` does not
disconnect an otherwise open idle client after5s. Closing stdin cleaned it up.
No DB credential or auth/SQL operation was used in that test.

## Offline operator and trust

```powershell
python -B scripts/ops/prepare-xmartmenu-private-transport.py --plan
python -B scripts/ops/test_xmartmenu_private_transport.py
python -B scripts/ops/prepare-xmartmenu-private-transport.py --bundle <NEW_LOCAL_DIRECTORY> --trusted-known-hosts C:\Users\Vanildo\.ssh\known_hosts
```

Rendering refuses an existing destination and extracts only the existing trusted
known_hosts ED25519 entry for49; marked/revoked entries or a different/missing
pin refuse. No keyscan, TOFU, new trust or secret is used. The existing local
known_hosts public key fingerprint and the server's public host key read over
the already trusted StrictHost session matched exactly:
`SHA256:XnGL1DaHCR2OOCEvHKz4S2rh0DSzwHrP9Bq9OMLgMC0`.
The bundle normalizes that public key, carries per-file source SHA256 hashes,
unit, sudo policy,12-slot tmpfiles policy and an **invalid placeholder** key
line; it cannot be installed as working authorization without the later public
key. No private key is generated or copied. A local review-only bundle exists
at`C:\Users\Vanildo\AppData\Local\Temp\xmartmenu-private-transport-review-20261104-v3`.
Regenerate into a new directory after edits; an earlier bundle is not current.

19 offline tests cover policy/target/source guards, exact host-key trust,
no-apply/no-overwrite, connection admission, no retry, bounded chunks/drain,
real fixture TCP/subprocess binary forwarding/half-close/remote EOF and the
SSLRequest-only health protocol and a stalled writer's bounded2s cleanup/slot
release. All19 passed on the real Linux host188 in the newly created root0700
directory`/tmp/xmartmenu-private-transport-test-20261104T125542Z-5f51df4e`.
The original generated service unit passed `systemd-analyze verify --man=no`
with no output. This authorized test wrote only public source/unit files inside
that new private directory; it created no key, account, service or SQL state.
Windows executes18 and explicitly skips the Linux flock test. Tests
never use real SSH, provider calls or any database. The real12-channel cgroup
budget, dedicated-key denial attempts, kernel BPF/unit behavior, SSH interruption,
PG restart recovery and absence of orphan nc processes remain unproven.

## Reviewed installation sequence remains gated

Before any install: independently review source and source hashes; run Linux
tests and systemd-analyze verify; repeat both read-only admissions on the exact
hosts; confirm absent users/services/policies/15432 and current known-host and
server public key match. A change in image/volume/network/source is a stop.
Do not overwrite a prior transport identity or reset existing state.

After coordinator approval only: create the two dedicated locked accounts with
no supplementary groups. Server home/.ssh/authorized_keys and script parents
must be root-owned and not group/world-writable; keep the normal shell solely
for sshd forced-command execution. No unrestricted keys, authorized_keys2,
password login, user rc or writable home is permitted. Install the zero-argument
script0755/root, sudoers0440/root only after visudo validation, and tmpfiles
slots0600/root under0700/root directory. The dedicated public authorized key is
root0644 under root0755 `/etc/ssh/authorized_keys`; sshd temporarily adopts the
user uid to read it, so root0600 would prevent authentication. The account can
read its public key but cannot edit it. Append the reviewed dedicated-user Match
block **at the end** of the existing main sshd config, preserving a backup,
digest and prior content. Recheck sshd -t and effective policies for this user and all existing
user classes, then perform a separately reviewed reload without terminating
existing sessions. Stop if effective policy of another user changes. Do not
place a Match block into an early wildcard drop-in or change global defaults.

On188 create the dedicated key **on that host**, private0600/client-user only,
public part copied to the reviewed forced-key line on49. Install the root-owned
known_hosts0644, root-owned non-writable config directory and root0755 scripts.
Install the reviewed unit; start only after matching source hashes and read-only
admission. Reject root-key reuse, agent forwarding, moving private key off188,
or placing it in app config. The separate installer below requires review before
any of these mutations.

Test positive protocol health and **negative** shell/command/PTY/agent/X11/port
forwarding/wrong-origin/13th-channel attempts; confirm exact listener in ss,
no public PG port, fixed12-slot limit and unchanged other services/DB roles.
Measure12 concurrent read-only protocol channels inside the128MiB service
cgroup, recent PSI/swap/PG counters, interruption and reconnect without replay.
These need no SQL login. Preserve results and stop on any new cap/OOM pressure.

Only a later separate cutover may enable the isolated SQL runtime login and set
the already supported explicit prefix URLs to10.0.4.1:15432/xmartmenu, matching
`PROD_DATABASE_HOST=10.0.4.1`, `PROD_DATABASE_NAME=xmartmenu` and explicit
`*_DATABASE_SSL=disable`. TLS-disable is limited to this private local bridge
plus authenticated encrypted SSH path; no connection URL/password is produced
here. Orders/Payments and other feature flags stayfalse. Each pool's size plus
all replicas/adapters must fit the shared12-slot role/transport budget before
activation. Payments legacy-writer freeze/reconciliation, Auth/data migration,
off-host backup and restore gates remain separate requirements.

Rollback a bridge-only installation by stopping the exact new unit and removing
its exact dedicated authorized key/sudo grant after checking no active sessions;
preserve keys/receipts for reviewed recovery until cleanup is authorized. Never
restart/resize/delete the shared PG, volume, candidate, source or other services.

## Installation operator and executed transport-only sequence

`scripts/ops/install-xmartmenu-private-transport.py` defaults to an offline plan.
Every mutable phase requires `--execute-reviewed-install` and the exact reviewed
SHA256 of its own staged file. Install phases additionally require the exact
offline bundle manifest SHA256, verify every source digest and private root-owned
bundle, and refuse existing accounts/groups, target files or prior install state.
Only public code and the existing public host-key pin go into the staged bundle.
Keep the installer and bundle root0600 in a new root0700 directory on each host.
No private key is copied in either direction. Do not put the install directory
under a shared app volume or use an existing production configuration directory.

The intended reviewed sequence is:

```bash
# All placeholders are exact reviewed public source hashes, not credentials.
#188: prepare the key/account/files; this does NOT start/enable the unit.
python3 -I install-xmartmenu-private-transport.py install-client \
  --bundle ./bundle --expected-manifest-sha256 <MANIFEST_SHA256> \
  --expected-operator-sha256 <INSTALLER_SHA256> --execute-reviewed-install

# Transfer ONLY /etc/xmartmenu-private-transport/id_ed25519.pub from188
# into a NEW root0600 file ./client.pub in the private staging directory on49.
# Compare its public fingerprint with the client receipt before authorizing.

#49: additive own user/sudo/key/locks plus reviewed scoped SSH config/reload.
python3 -I install-xmartmenu-private-transport.py install-server \
  --bundle ./bundle --expected-manifest-sha256 <MANIFEST_SHA256> \
  --public-key-file ./client.pub --expected-operator-sha256 <INSTALLER_SHA256> \
  --execute-reviewed-install
python3 -I install-xmartmenu-private-transport.py verify-server \
  --expected-operator-sha256 <INSTALLER_SHA256>

#188: rerun current capacity/network admission, enable+start, inspect unit/bind,
# then perform protocol-only health and inspect the actual cgroup counters.
python3 -I install-xmartmenu-private-transport.py start-client \
  --expected-operator-sha256 <INSTALLER_SHA256> --execute-reviewed-install
python3 -I install-xmartmenu-private-transport.py verify-client \
  --expected-operator-sha256 <INSTALLER_SHA256>
```

Server preflight compares effective SSH policies for **every existing local
account** across the current administrative source,188 and loopback, and verifies
the dedicated policy separately before and after creating its account. It
refuses any change in existing policy, validates sudo/sshd syntax, appends the
Match block directly atEOF, rechecks the shared-config digest for concurrency,
then reloads SSH. Prior config and public-source fingerprints are retained in
root0700 `/var/lib/xmartmenu-private-transport-install`. Other users' Match rules,
global defaults, host keys, SMTP and Google services are never rewritten.
Installed file writes are exclusive; shared SSH config uses atomic replacement
with a saved recovery digest. No persistent database write is performed. Server
verification checks the actual role is still NOLOGIN/limit12 using a bounded
READ ONLY catalog transaction and verifies the exact private PG identity.

`start-client` also supports explicit recovery when the **same** bridge ID/device
returns after dependency loss. `BindsTo` stops the service, while
`Restart=on-failure` does not automatically start it when that device returns.
After current admission, the operator explicitly runs `systemctl start
xmartmenu-private-transport.service`; the unit repeats admission in ExecStartPre.
A different network ID remains refused. Manual equivalent, only after review:

```bash
python3 -I /usr/local/libexec/prepare-xmartmenu-private-transport.py --admit-local client
systemctl start xmartmenu-private-transport.service
```

Fifteen installer policy tests run offline with mocked OS commands: default
plan/hash gates, full public ED25519 wire validation, manifest/source tampering,
all existing SSH contexts, exact dedicated restrictions, fresh user/group/path
gates, concurrent SSH-config rollback refusal, atomic receipt writes, and manual
bridge recovery's admission-before-start sequence. No user/key/service/SSH/SQL
operation occurs in those tests. They passed on Linux after review, including
write/chown/receipt-save failure cleanup and preservation of a substituted inode.
No private key was involved in those tests.

Rollback is explicit, first188 then49, using the exact reviewed installer hash:

```bash
python3 -I install-xmartmenu-private-transport.py rollback-client \
  --expected-operator-sha256 <INSTALLER_SHA256> --execute-reviewed-install
python3 -I install-xmartmenu-private-transport.py rollback-server \
  --expected-operator-sha256 <INSTALLER_SHA256> --execute-reviewed-install
```

It stops/disables only this unit, verifies source/receipt digests, and quarantines
the private key root0600 inside the root0700 receipt directory **on188**. Server
rollback requires no active slot, restores the original SSH file only if its
current hash is exactly the reviewed before/after state, validates/reloads SSH,
then removes only exact recorded own files. A concurrent shared-file change is
a stop, never overwritten. Newly created locked accounts, empty directories and
receipts/backups remain for review; there is no recursive deletion or automatic
user/group removal. Partial installation is preserved on error, not silently
retried; a receipt/file mismatch or crash before its completion receipt requires
manual reconciliation. Rollback does not change PG, its volume, any SQL role,
application variables, app deployment or other service.

The positive/negative SSH permission tests,12-channel cgroup budget proof,
network interruption cleanup/recovery and complete writer/backup/cutover gates
still apply after a transport-only installation. A green basic health is not
permission to activate an app flag or SQL login.

## Executed host-socket upgrade and final protocol proof

The separately reviewed `upgrade-xmartmenu-pg-stdio.py` replaced only the server
wrapper and made an explicit revision of its installed-file receipt. It held
all12 slots, verified exact source/receipt hashes, made root0700 recovery files,
fsynced both recovery directory and its parent before replacement, and preserved
the original bundle as historical evidence. It performs no SQL writes or
credential/env change. Six upgrade policy tests and seven root/Linux relay tests
passed, including20s idle after protocol response, binary/backpressure handling,
irreversible UID/group/capability drop, disconnect cleanup and secret-free Docker
metadata selection. The real selected Docker templates passed live read-only
validation. No Config.Env was passed into the unprivileged relay heap.

Installed source and recovery pins:

|Artifact|SHA256|
|---|---|
|Original installer|`c06bb6a09be447b9e6486c000eb655cc1a0b393e8fa36f4b111cfe6970aaf0d1`|
|Original historical LF bundle|`534c53d694bf7ca6e9a5da75c5c15b4dafee65029178b533549188e713f86098`|
|Old nc wrapper, stopped/replaced|`0039d08b691a9b9e462e77a5a6c8262700ceab6239a3647bb01bb18a72a8d040`|
|New host-socket wrapper|`3ceff767ed9b062b52c2c1784769dd0b10e29e5494ef081a79a536fed1727a5f`|
|Reviewed upgrade operator|`5a80101830b67d166f46e6f27ee15892d193a0070e8dff323efd6eab2ea1dec2`|
|Revised server receipt|`5d282c7dc3e03f005303e60a45e14526b49e824b4aa41b3453a3fd7d223c0288`|
|Upgrade recovery manifest|`b74767fbe4c3e605948d29342b517bde4b476781b21fd213020ae76983eccd0a`|

Recovery is on49 in
`/var/lib/xmartmenu-private-transport-install/stdio-host-relay-v2`, including
the old public source and exact before/after operational receipts. It contains
no private SSH/SQL key. The explicit upgrade rollback recognizes only its own
known before/after source+receipt pairs; any unrelated change refuses overwrite.
Do not start the restored old nc implementation for production use.

After upgraded server verification, the client was started and verified healthy.
`probe-xmartmenu-private-transport.py` then opened twelve protocol-only channels
from the actual app container on the private bridge. Each sent only SSLRequest,
received N/S and kept **both directions open**. It admits channels sequentially
for a sustained-capacity proof; it does not claim a twelve-way burst meets the
bounded handshake queue. The periodic heartbeat shares the12-slot budget, so
the probe waits for its quiet window without changing the service.

Final observed proof:

- Twelve channels ready after7039ms and still open after20s of retention;
  oldest-channel age27054ms at intentional release, below PG pre-auth60s.
- Thirteenth channel denied; SSH remote command and stdio forwarding denied.
- Client sampled29MiB / cgroup historical peak30MiB under its128MiB limit;
  no new high/max/OOM/OOM-kill events.
- Protocol health after release remained true. Final generic verify-client
  reported12MiB and the sole listener10.0.4.1:15432.
- Independent final server checks:37 existing SSH policies unchanged, PG healthy,
  current209MiB, historical peak512MiB/max653 unchanged, OOM0, public PG ports0,
  old nc processes0, all server slots released, host available1721MiB.
- Runtime remains NOLOGIN/limit12; no SQL authentication, SQL write, app variable,
  flag, public endpoint, production app deployment or new billing resource.

`verify-client` itself always reports`twelveChannelBudgetProven=false` because
that narrow verifier does not run a load test. The separate probe result above
is the load evidence; the client receipt was not silently rewritten to claim it.
Some attempts stopped at a transient host-capacity preflight before enable/start
or before opening channels. Those attempts were re-admitted using three fresh
good samples with unchanged thresholds; no ambiguous mutation was retried.

Remaining cutover gates include native SQL credentials/login review, actual app
adapter integration, total pool/replica budget, legacy-writer reconciliation and
off-host backup/restore readiness. The protocol-only proof does not replace them.

## Primary references

[OpenSSH authorized_keys restrictions and host-key revocation](https://man.openbsd.org/sshd.8)
describe the forced-key restrictions;[ssh_config](https://man.openbsd.org/ssh_config.5)
documents strict host-key, identity and connection options. The installed
OpenSSH/sudo outputs above are the operational compatibility evidence.
[Python3.12 streams](https://docs.python.org/3.12/library/asyncio-stream.html)
and[subprocesses](https://docs.python.org/3.12/library/asyncio-subprocess.html)
document stream limits, drain and process cleanup responsibilities.
[systemd execution restrictions](https://www.freedesktop.org/software/systemd/man/255/systemd.exec.html)
and[resource controls](https://www.freedesktop.org/software/systemd/man/255/systemd.resource-control.html)
describe the proposed service sandbox and cgroup limits; verify actual kernel
support and applied properties during the separately reviewed installation.
