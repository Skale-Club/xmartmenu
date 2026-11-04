#!/usr/bin/env bash
# Temporary XmartMenu restore only, on the explicitly reviewed Xmail host.
set +x
set -Eeuo pipefail
if [[ $# == 0 || ( $# == 1 && $1 == --plan ) ]]; then
  cat <<'PLAN'
PLAN ONLY: no filesystem, Docker, SSH or database operation is performed.
Host skaleclub-mail / 49.13.197.250; no existing PostgreSQL resource is a target.
Exact cached PG17 and Node helper images; no pull, provisioning or persistent volume.
Fresh >=1536MiB available RAM, inactive swap-out/low PSI/CPU admission before phases.
Source and TOC phase: client128+crypto128+host tmpfs64 =320MiB worst budget.
Restore phase: target256 (includes pg_restore/psql/data tmpfs)+crypto128+host tmpfs64 =448MiB.
No separate client128 runs while target is resident. Host CLI margin also required.
Source47 public tables via one exported READ ONLY RR snapshot with strict CA/TLS.
PG* credentials memory/stdin, AES-GCM key memory/stdin, encrypted archive only in tmpfs.
Target network none, no ports, no persistent volume; auth scaffold is NOT migrated login.
Only the one CREATE SCHEMA public TOC entry is omitted; SQL/COPY bodies never rewritten.
Cleanup only this run's labels/tmpfs, never Xmail candidate, volumes or backups.
No production DDL, migration replay, app environment change, CI data or deployment.
PLAN
  exit 0
fi
if [[ $# != 1 || $1 != --execute-reviewed-rehearsal ]]; then
  echo 'Refused: use --plan or --execute-reviewed-rehearsal through the reviewed orchestrator.' >&2; exit 2
fi
[[ $(id -u) == 0 && $(hostname) == skaleclub-mail && $(nproc) == 2 ]] || exit 2
for binary in docker timeout awk df mktemp mount umount mountpoint findmnt stat openssl vmstat rmdir; do command -v "$binary" >/dev/null || exit 2; done
code_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
[[ $code_dir == /opt/xmartmenu/rehearsal && ! -L /opt/xmartmenu && ! -L /opt/xmartmenu/rehearsal && $(stat -c '%u:%a' "$code_dir") == 0:700 ]] || exit 2
for file in xmartmenu-database-rehearsal.sh xmartmenu-archive-crypto.mjs xmartmenu-source-protocol.mjs; do
  [[ -f $code_dir/$file && ! -L $code_dir/$file && $(stat -c '%u:%a' "$code_dir/$file") == 0:600 ]] || exit 2
done
image=sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b
helper_image=sha256:93c4f3284e452b518dfd7f7363152976cd1d1e3d1a28f76814b8a0ea9797b58d
[[ $(docker image inspect --format '{{.Id}}' "$image") == "$image" && $(docker image inspect --format '{{.Id}}' "$helper_image") == "$helper_image" ]] || exit 2
[[ $(docker image inspect --format '{{json .Config.Volumes}}' "$image") == '{"/var/lib/postgresql/data":{}}' && $(docker image inspect --format '{{json .Config.Volumes}}' "$helper_image") == null ]] || exit 2
check_capacity() {
  local available swap disk path
  available=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
  swap=$(awk '/^SwapTotal:/ {t=$2} /^SwapFree:/ {f=$2} END {print t-f}' /proc/meminfo)
  (( available >= 1572864 && swap <= 524288 )) || { echo 'Rehearsal capacity gate refused.' >&2; exit 2; }
  for path in /tmp /opt /var/lib/docker; do
    disk=$(df -Pk "$path" | awk 'END {print $4}'); (( disk >= 2097152 )) || exit 2
  done
  awk '/^some/ {for(i=1;i<=NF;i++)if($i~/^avg60=/){split($i,v,"=");if(v[2]>0.10)exit 2}} /^full/ {for(i=1;i<=NF;i++)if($i~/^avg60=/){split($i,v,"=");if(v[2]>0.05)exit 2}}' /proc/pressure/memory
  timeout 10s vmstat 1 4 | awk 'NR>3 {seen++;if($8>0||$7>64||$15<50)bad=1} END {if(bad||seen<3)exit 2}'
}
check_capacity
umask 077
work=$(mktemp -d /tmp/xmartmenu-db-rehearsal.XXXXXXXX)
[[ $work =~ ^/tmp/xmartmenu-db-rehearsal\.[a-zA-Z0-9]{8}$ && -d $work && ! -L $work ]] || exit 2
nonce="$(date -u +%Y%m%dT%H%M%SZ)-$$"
client="xmartmenu-rehearsal-$nonce-client"; helper="xmartmenu-rehearsal-$nonce-crypto"; target="xmartmenu-rehearsal-$nonce-target"
label_key=com.skale.xmartmenu-db-rehearsal
archive_key='' source_environment='' packet='' stage=initialization
cleanup() {
  local resource resource_owner mount_info
  for resource in "$client" "$helper" "$target"; do
    resource_owner=$(docker inspect --format "{{index .Config.Labels \"$label_key\"}}" "$resource" 2>/dev/null || true)
    if [[ $resource_owner == "$nonce" ]]; then docker rm -f "$resource" >/dev/null 2>&1 || true; fi
  done
  if [[ $work =~ ^/tmp/xmartmenu-db-rehearsal\.[a-zA-Z0-9]{8}$ && -d $work && ! -L $work ]]; then
    if mountpoint -q "$work"; then
      mount_info=$(findmnt -rn -T "$work" -o TARGET,FSTYPE)
      if [[ $mount_info == "$work tmpfs" ]]; then umount -- "$work" >/dev/null 2>&1 || true; fi
    fi
    if ! mountpoint -q "$work"; then rmdir -- "$work" >/dev/null 2>&1 || true; fi
  fi
  unset archive_key source_environment packet
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
trap 'echo "XmartMenu rehearsal failed in $stage; source/app unchanged, private diagnostics omitted." >&2' ERR
mount -t tmpfs -o size=67108864,mode=0700,nosuid,nodev,noexec tmpfs "$work" > /dev/null 2>&1
run_helper() {
  local duration=45s
  [[ $1 != encrypt ]] || duration=155s
  timeout --kill-after=5s "$duration" docker run --rm --pull=never --name "$helper" --label "$label_key=$nonce" --log-driver=none \
    --network none --read-only --user 0:0 --memory 128m --memory-swap 128m --cpus 0.25 --pids-limit 32 \
    --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp:rw,nosuid,nodev,size=8388608 \
    --mount "type=bind,src=$code_dir,dst=/ops,readonly" --mount "type=bind,src=$work,dst=/private" \
    --entrypoint node "$helper_image" --max-old-space-size=48 /ops/xmartmenu-archive-crypto.mjs "$@"
}
IFS= read -r -t 30 packet
[[ ${#packet} -le 131072 && $packet == \{* ]] || exit 2
stage=source-admission
source_environment=$(printf '%s' "$packet" | run_helper admit 2>"$work/admission.log")
unset packet
snapshot_id=$(cat "$work/snapshot.id"); [[ $snapshot_id =~ ^[a-fA-F0-9]{8}-[a-fA-F0-9]{8}-[0-9]+$ ]] || exit 2
archive_key=$(openssl rand -hex 32); [[ $archive_key =~ ^[a-f0-9]{64}$ ]] || exit 2
stage=source-dump-encryption
{
  printf '%s\n' "$archive_key"
  printf '%s\n' "$source_environment" | timeout --kill-after=5s 150s docker run --rm --pull=never --name "$client" --label "$label_key=$nonce" --log-driver=none \
    --network bridge --read-only --memory 128m --memory-swap 128m --cpus 0.5 --pids-limit 64 --cap-drop ALL --security-opt no-new-privileges \
    --tmpfs /tmp:rw,nosuid,nodev,size=8388608 --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,size=1048576 \
    --mount "type=bind,src=$work/source-ca.crt,dst=/private/source-ca.crt,readonly" --env-file /dev/stdin "$image" \
    pg_dump --format=custom --compress=6 --schema=public --schema=supabase_migrations --strict-names --no-owner --no-acl --no-comments \
      --snapshot="$snapshot_id" --lock-wait-timeout=2s 2>"$work/dump.log"
} | run_helper encrypt >"$work/encryption.log" 2>&1
unset source_environment
[[ -s $work/archive.gcm ]] || exit 2
printf '%s\n' "$archive_key" | run_helper verify >"$work/archive-verification.log" 2>&1
printf 'SNAPSHOT_DUMP_COMPLETE\n'
IFS= read -r -t 15 source_status; [[ $source_status == SOURCE_RELEASED ]] || exit 2
stage=toc-validation
offline_client() {
  timeout --kill-after=5s 45s docker run --rm --pull=never --name "$client" --label "$label_key=$nonce" --log-driver=none \
    --network none --read-only --memory 128m --memory-swap 128m --cpus 0.5 --pids-limit 64 --cap-drop ALL --security-opt no-new-privileges \
    --tmpfs /tmp:rw,nosuid,nodev,size=8388608 --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,size=1048576 "$image" "$@"
}
# This separate client runs BEFORE the server exists, never alongside it.
printf '%s\n' "$archive_key" | run_helper decrypt 2>"$work/toc-decrypt.log" | offline_client pg_restore --list >"$work/archive.list" 2>"$work/toc.log"
run_helper toc >"$work/toc-policy.log" 2>&1
image_probe=$(offline_client sh -c 'id -u postgres; id -g postgres; pg_dump --version' 2>"$work/image-probe.log")
mapfile -t image_details <<<"$image_probe"
[[ ${#image_details[@]} == 3 && ${image_details[0]} =~ ^[1-9][0-9]{0,5}$ && ${image_details[1]} =~ ^[1-9][0-9]{0,5}$ && ${image_details[2]} == 'pg_dump (PostgreSQL) 17.'* ]] || exit 2
uid=${image_details[0]}; gid=${image_details[1]}
check_capacity
stage=target-initialization
docker run -d --rm --pull=never --name "$target" --label "$label_key=$nonce" --log-driver=none --network none --read-only \
  --memory 256m --memory-swap 256m --cpus 0.5 --pids-limit 64 --cap-drop ALL --security-opt no-new-privileges --user "$uid:$gid" \
  --env POSTGRES_HOST_AUTH_METHOD=trust --env POSTGRES_DB=xmartmenu_rehearsal \
  --tmpfs "/var/lib/postgresql/data:rw,nosuid,nodev,size=134217728,uid=$uid,gid=$gid,mode=0700" \
  --tmpfs "/var/run/postgresql:rw,nosuid,nodev,size=8388608,uid=$uid,gid=$gid,mode=0700" --tmpfs /tmp:rw,nosuid,nodev,size=8388608 \
  --mount "type=bind,src=$work,dst=/private,readonly" "$image" postgres -c listen_addresses='' -c shared_buffers=16MB -c work_mem=1MB \
    -c maintenance_work_mem=16MB -c max_connections=8 -c max_wal_size=64MB -c min_wal_size=32MB -c wal_level=minimal -c max_wal_senders=0 \
    -c archive_mode=off -c autovacuum=off -c statement_timeout=180000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=30000 -c transaction_timeout=210000 \
    >"$work/target.id" 2>"$work/target-start.log"
for attempt in {1..80}; do
  if docker exec "$target" sh -c 'test "$(head -n 1 /var/lib/postgresql/data/postmaster.pid 2>/dev/null)" = 1 && pg_isready -q -U postgres -d xmartmenu_rehearsal'; then break; fi > /dev/null 2>&1
  sleep 0.25
done
docker exec "$target" sh -c 'test "$(head -n 1 /var/lib/postgresql/data/postmaster.pid 2>/dev/null)" = 1 && pg_isready -q -U postgres -d xmartmenu_rehearsal' >"$work/target-ready.log" 2>&1
stage=target-compatibility
timeout --kill-after=5s 20s docker exec -i --user 0:0 "$target" psql -X -w -v ON_ERROR_STOP=1 -U postgres -d xmartmenu_rehearsal <"$work/compatibility.sql" >"$work/compatibility.log" 2>&1
# pg_restore AND psql execute INSIDE the target's256MiB cgroup. Their SQL is
# streamed through pipes, never stored as plaintext. The four exact pg_restore
# timeout-disabling preamble SETs alone are removed; object/COPY bodies stay exact.
stage=target-restore
{
  printf "BEGIN; SET LOCAL transaction_timeout='210s'; SET LOCAL statement_timeout='180s'; SET LOCAL lock_timeout='2s'; SET LOCAL idle_in_transaction_session_timeout='30s';\n"
  printf '%s\n' "$archive_key" | run_helper decrypt 2>"$work/restore-decrypt.log" | timeout --kill-after=5s 45s docker exec -i --user 0:0 "$target" \
    pg_restore --exit-on-error --no-owner --no-acl --use-list=/private/restore.list --file=- 2>"$work/restore-generate.log" | awk '
    /^-- Name:/ {body=1}
    !body && ($0=="SET statement_timeout = 0;" || $0=="SET lock_timeout = 0;" || $0=="SET idle_in_transaction_session_timeout = 0;" || $0=="SET transaction_timeout = 0;") {removed++;next}
    {print}
    END {if(removed!=4)exit 2}
  '
  printf '\nCOMMIT;\n'
} | timeout --kill-after=5s 220s docker exec -i "$target" psql -X -w -v ON_ERROR_STOP=1 -U postgres -d xmartmenu_rehearsal >"$work/restore.log" 2>&1
stage=target-manifest
{
  printf "BEGIN READ ONLY; SET LOCAL statement_timeout='30s'; SET LOCAL timezone='UTC'; SET LOCAL datestyle='ISO, YMD'; SET LOCAL extra_float_digits=3; SET LOCAL bytea_output='hex';\n"
  cat "$work/manifest.sql"; printf ';\nROLLBACK;\n'
} | timeout --kill-after=5s 40s docker exec -i "$target" psql -X -w -qAt -v ON_ERROR_STOP=1 -U postgres -d xmartmenu_rehearsal >"$work/target-manifest.json" 2>"$work/manifest.log"
stage=reconciliation
final_report=$(run_helper compare 2>"$work/compare.log")
[[ $final_report == \{* && ${#final_report} -le 16384 ]] || exit 2
stage=cleanup
cleanup
remaining=$(docker ps -aq --filter "label=$label_key=$nonce" 2>/dev/null)
[[ -z $remaining && ! -e $work && ! -L $work ]] || { echo 'Rehearsal cleanup proof failed; success withheld.' >&2; exit 1; }
trap - EXIT
printf '%s\n' "$final_report"
