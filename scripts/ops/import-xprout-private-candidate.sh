#!/usr/bin/env bash
# Add one database to the exact existing cluster; never reset/restart a resource.
set +x
set -Eeuo pipefail
if [[ $# == 0 || ( $# == 1 && $1 == --plan ) ]]; then
  cat <<'PLAN'
PLAN ONLY: no filesystem, Docker, source or database operation.
Existing PG17 e12scyfsrp822dag7m9wwd4x on skaleclub-mail; database xmartmenu only.
New database/owner/runtime/staging-reader must be absent; no retry/reset of partial state.
Host1536MiB available,swap<=512MiB,no swap-out,low PSI,CPU>=50%,disk>=3GiB.
Existing512MiB cgroup current<=320MiB,peak<=384MiB,zeroOOM;<=40 connections/max>=80.
No new PG container, existing resource restart, public port, Xmail database write or app change.
One source verified-TLS exported READ ONLY snapshot;47 tables/full-row digests,6 ID groups,2 sequences.
NOLOGIN own roles, existing global Auth roles verified and never altered.
Restore to new database in one transaction, compare before COMMIT and again afterward.
New encrypted archive and root-only recovery key retained durably before COMMIT.
Failure preserves partial database/roles and backup bundle. Never auto-clean persistent state.
ICU153.121->153.136 is accepted only from an explicit reviewed controller flag; en-US/rulesNULL exact.
All collatable columns/array elements and global corpus native ordering/equality/casefold must match beforeCOMMIT.
No login migration, runtime transport, off-host/R2/PITR/schedule or production cutover.
PLAN
  exit 0
fi
[[ $# == 1 && $1 == --execute-reviewed-import ]] || exit 2
[[ $(id -u) == 0 && $(hostname) == skaleclub-mail && $(nproc) == 2 ]] || exit 2
for binary in docker timeout awk df mktemp stat vmstat flock install sync python3 openssl cmp sed wc; do command -v "$binary" >/dev/null || exit 2; done
code_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
[[ $code_dir == /opt/xmartmenu/persistent-import && ! -L /opt/xmartmenu && ! -L $code_dir && $(stat -c '%u:%a' "$code_dir") == 0:700 ]] || exit 2
for file in import-xprout-private-candidate.sh import-xprout-private-candidate.helper.mjs xprout-archive-crypto.mjs xprout-source-protocol.mjs; do
  [[ -f $code_dir/$file && ! -L $code_dir/$file && $(stat -c '%u:%a' "$code_dir/$file") == 0:600 ]] || exit 2
done
umask 077
exec 9>"$code_dir/import.lock"; flock -n 9 || exit 2
target=e12scyfsrp822dag7m9wwd4x
database=xmartmenu
owner=xmartmenu_owner
image=sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b
helper_image=sha256:93c4f3284e452b518dfd7f7363152976cd1d1e3d1a28f76814b8a0ea9797b58d
[[ $(docker image inspect --format '{{.Id}}' "$image") == "$image" && $(docker image inspect --format '{{.Id}}' "$helper_image") == "$helper_image" ]] || exit 2
assert_target() {
  local found
  found=$(docker inspect --format '{{.Image}}|{{.State.Running}}|{{.State.Health.Status}}|{{.HostConfig.Memory}}|{{.HostConfig.MemorySwap}}|{{.HostConfig.NanoCpus}}' "$target")
  [[ $found == "$image|true|healthy|536870912|536870912|750000000" && -z $(docker port "$target") ]] || exit 2
  found=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Type}}|{{.Name}}|{{.RW}}{{end}}{{end}}' "$target")
  [[ $found == "volume|postgres-data-$target|true" ]] || exit 2
}
check_capacity() {
  local available swap path disk current peak
  available=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
  swap=$(awk '/^SwapTotal:/ {t=$2} /^SwapFree:/ {f=$2} END {print t-f}' /proc/meminfo)
  (( available>=1572864 && swap<=524288 )) || exit 2
  for path in /tmp /opt /var/lib/docker; do
    disk=$(df -Pk "$path" | awk 'END {print $4}'); (( disk>=3145728 )) || exit 2
    case $(stat -f -c '%T' "$path") in tmpfs|ramfs|hugetlbfs|devtmpfs) exit 2 ;; esac
  done
  awk '/^some/ {for(i=1;i<=NF;i++)if($i~/^avg60=/){split($i,v,"=");if(v[2]>0.10)exit 2}} /^full/ {for(i=1;i<=NF;i++)if($i~/^avg60=/){split($i,v,"=");if(v[2]>0.05)exit 2}}' /proc/pressure/memory
  timeout 10s vmstat 1 4 | awk 'NR>3 {n++;if($8>0||$7>64||$15<50)bad=1} END {if(bad||n<3)exit 2}'
  TARGET="$target" python3 - <<'PY'
import json,os,subprocess
p=json.loads(subprocess.check_output(['docker','inspect',os.environ['TARGET']],stderr=subprocess.DEVNULL))[0]['State']['Pid']
cg='/sys/fs/cgroup'+open('/proc/%s/cgroup'%p).read().strip().split(':')[-1]
assert int(open(cg+'/memory.current').read())<=320*1048576
assert int(open(cg+'/memory.peak').read())<=384*1048576
assert not any(int(v) for k,v in (l.split() for l in open(cg+'/memory.events')) if k in ('oom','oom_kill','max'))
PY
}
admin_sql() { timeout --kill-after=5s 20s docker exec -i "$target" psql -X -w -qAt -v ON_ERROR_STOP=1 -U xmail_owner -d postgres; }
assert_target
check_capacity
# Read-only cluster metadata. Exact own names must not have existed before this run.
initial_guard=$(cat <<'SQL'
DO $$ BEGIN
 IF current_database()<>'postgres' OR current_user<>'xmail_owner' OR session_user<>'xmail_owner'
 OR NOT (SELECT rolsuper FROM pg_roles WHERE rolname=current_user)
 OR current_setting('server_version_num')::int/10000<>17
 OR current_setting('max_connections')::int<80 OR (SELECT count(*) FROM pg_stat_activity)>40
 OR EXISTS(SELECT FROM pg_database WHERE datname='xmartmenu')
 OR EXISTS(SELECT FROM pg_roles WHERE rolname IN ('xmartmenu_owner','xmartmenu_runtime','xmartmenu_staging_reader'))
 OR NOT EXISTS(SELECT FROM pg_database WHERE datname='xmail')
 OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated')
 OR EXISTS(SELECT FROM pg_roles WHERE rolname IN ('authenticated','service_role') AND (rolsuper OR rolcanlogin OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication))
 OR EXISTS(SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid OR r.oid=m.member WHERE r.rolname IN ('authenticated','service_role'))
 THEN RAISE EXCEPTION 'Shared cluster admission or initial target state refused'; END IF;
END $$;
SQL
)
printf 'BEGIN READ ONLY; SET LOCAL statement_timeout=10000;\n%s\nROLLBACK;\n' "$initial_guard" | admin_sql >/dev/null 2>&1
work=$(mktemp -d /tmp/xmartmenu-persistent-import.XXXXXXXX)
[[ $work =~ ^/tmp/xmartmenu-persistent-import\.[a-zA-Z0-9]{8}$ && ! -L $work ]] || exit 2
nonce="$(date -u +%Y%m%dT%H%M%SZ)-$$"
client="xmartmenu-persistent-$nonce-client"; helper="xmartmenu-persistent-$nonce-helper"
label_key=com.skale.xmartmenu-persistent-import
archive_key='' source_environment='' packet='' target_input='' target_output='' target_pid=''
backup_dir='' committed=false
cleanup() {
  local resource found file
  if [[ ${target_input:-} =~ ^[0-9]+$ ]]; then exec {target_input}>&-; target_input=''; fi
  if [[ ${target_output:-} =~ ^[0-9]+$ ]]; then exec {target_output}<&-; target_output=''; fi
  for resource in "$client" "$helper"; do
    found=$(docker inspect --format "{{index .Config.Labels \"$label_key\"}}" "$resource" 2>/dev/null || true)
    if [[ $found == "$nonce" ]]; then docker rm -f "$resource" >/dev/null 2>&1 || true; fi
  done
  if [[ $work =~ ^/tmp/xmartmenu-persistent-import\.[a-zA-Z0-9]{8}$ && -d $work && ! -L $work ]]; then
    # Fixed nonce-owned scratch only. No database/volume/backup/key cleanup.
    rm -rf -- "$work"
  fi
  unset archive_key source_environment packet
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
trap 'echo "Persistent Xmart import failed; partial target/backups preserved; no cutover or raw diagnostics." >&2' ERR
run_helper() {
  local duration=45s
  [[ $1 != encrypt ]] || duration=155s
  timeout --kill-after=5s "$duration" docker run -i --rm --pull=never --name "$helper" --label "$label_key=$nonce" --log-driver=none \
    --network none --read-only --user 0:0 --memory 128m --memory-swap 128m --cpus 0.25 --pids-limit 32 --cap-drop ALL --security-opt no-new-privileges \
    --tmpfs /tmp:rw,nosuid,nodev,size=8388608 --mount "type=bind,src=$code_dir,dst=/ops,readonly" --mount "type=bind,src=$work,dst=/private" \
    --entrypoint node "$helper_image" --max-old-space-size=80 /ops/import-xprout-private-candidate.helper.mjs "$@"
}
offline_client() {
  timeout --kill-after=5s 45s docker run -i --rm --pull=never --name "$client" --label "$label_key=$nonce" --log-driver=none \
    --network none --read-only --memory 128m --memory-swap 128m --cpus 0.5 --pids-limit 64 --cap-drop ALL --security-opt no-new-privileges \
    --tmpfs /tmp:rw,nosuid,nodev,size=8388608 --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,size=1048576 \
    --mount "type=bind,src=$work,dst=/private,readonly" "$image" "$@"
}
# Fingerprint existing Xmail rows and existing Auth role attributes, without exporting their values.
xmail_proof=$(cat <<'SQL'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='20s'; SET LOCAL search_path=pg_catalog,public; SET LOCAL timezone='UTC'; SET LOCAL datestyle='ISO, YMD'; SET LOCAL extra_float_digits=3; SET LOCAL bytea_output='hex';
WITH tables AS (SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')),
rows AS (SELECT relname,(xpath('/row/value/text()',query_to_xml(format($q$SELECT encode(sha256(convert_to(coalesce(string_agg(h,'' ORDER BY h COLLATE "C"),''),'UTF8')),'hex') AS value FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS h FROM public.%I t) x$q$,relname),false,true,'')))[1]::text AS value FROM tables)
SELECT jsonb_build_object('publicTables',(SELECT count(*) FROM tables),'rows',jsonb_object_agg(relname,value),'authenticated',(SELECT jsonb_build_object('oid',oid,'super',rolsuper,'login',rolcanlogin,'bypass',rolbypassrls,'createdb',rolcreatedb,'createrole',rolcreaterole,'replication',rolreplication,'inherit',rolinherit,'limit',rolconnlimit,'config',rolconfig) FROM pg_roles WHERE rolname='authenticated')) FROM rows;
ROLLBACK;
SQL
)
printf '%s\n' "$xmail_proof" | timeout 30s docker exec -i "$target" psql -X -w -qAt -v ON_ERROR_STOP=1 -U xmail_owner -d xmail >"$work/xmail-before.json" 2>"$work/xmail-before.log"
IFS= read -r -t 30 packet
[[ ${#packet} -le 1048576 && $packet == \{* ]] || exit 2
source_environment=$(printf '%s' "$packet" | run_helper admit 2>"$work/admission.log"); unset packet
snapshot_id=$(cat "$work/snapshot.id"); [[ $snapshot_id =~ ^[a-fA-F0-9]{8}-[a-fA-F0-9]{8}-[0-9]+$ ]] || exit 2
archive_key=$(openssl rand -hex 32); [[ $archive_key =~ ^[a-f0-9]{64}$ ]] || exit 2
{
  printf '%s\n' "$archive_key"
  printf '%s\n' "$source_environment" | timeout --kill-after=5s 150s docker run --rm --pull=never --name "$client" --label "$label_key=$nonce" --log-driver=none \
    --network bridge --read-only --memory 128m --memory-swap 128m --cpus 0.5 --pids-limit 64 --cap-drop ALL --security-opt no-new-privileges \
    --tmpfs /tmp:rw,nosuid,nodev,size=8388608 --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,size=1048576 \
    --mount "type=bind,src=$work/source-ca.crt,dst=/private/source-ca.crt,readonly" --env-file /dev/stdin "$image" \
    pg_dump --format=custom --compress=6 --schema=public --schema=supabase_migrations --strict-names --no-owner --no-acl --no-comments \
    --snapshot="$snapshot_id" --lock-wait-timeout=2s 2>"$work/dump.log"
} | run_helper encrypt >"$work/encrypt.log" 2>&1
unset source_environment
printf '%s\n' "$archive_key" | run_helper verify >"$work/verify.log" 2>&1
printf 'SNAPSHOT_DUMP_COMPLETE\n'
IFS= read -r -t 15 source_status; [[ $source_status == SOURCE_RELEASED ]] || exit 2
printf '%s\n' "$archive_key" | run_helper decrypt 2>"$work/decrypt.log" | offline_client pg_restore --list >"$work/archive.list" 2>"$work/toc.log"
run_helper toc >"$work/toc-policy.log" 2>&1
printf '%s\n' "$archive_key" | run_helper decrypt 2>"$work/decrypt-sql.log" | offline_client pg_restore --exit-on-error --no-owner --no-acl --use-list=/private/restore.list --file=- >"$work/restore.sql" 2>"$work/restore-generate.log"
run_helper bound >"$work/bound.log" 2>&1
# Durable recoverable encrypted bundle must precede all target creation/COMMIT.
[[ ! -L /opt/xmartmenu/backups ]] || exit 2
if [[ ! -e /opt/xmartmenu/backups ]]; then install -d -m 0700 /opt/xmartmenu/backups; fi
[[ $(stat -c '%u:%a' /opt/xmartmenu/backups) == 0:700 ]] || exit 2
backup_dir=$(mktemp -d "/opt/xmartmenu/backups/import-$nonce.XXXXXXXX")
[[ $backup_dir =~ ^/opt/xmartmenu/backups/import-[a-zA-Z0-9.-]+$ && ! -L $backup_dir ]] || exit 2
install -m 0400 "$work/archive.gcm" "$backup_dir/archive.gcm"
printf '%s\n' "$archive_key" >"$backup_dir/archive.key"; chmod 0400 "$backup_dir/archive.key"
install -m 0600 "$work/source-manifest.json" "$backup_dir/source-manifest.json"
for file in source-text-columns.json source-text-semantics.json import-options.json; do
  install -m 0600 "$work/$file" "$backup_dir/$file"
done
cmp -s "$work/archive.gcm" "$backup_dir/archive.gcm"
[[ $(cat "$backup_dir/archive.key") == "$archive_key" ]]
(cd "$backup_dir" && sha256sum archive.gcm >archive.sha256 && sha256sum -c archive.sha256 >/dev/null)
sync -f "$backup_dir/archive.gcm"; sync -f "$backup_dir/archive.key"; sync -f "$backup_dir"
assert_target; check_capacity
cat "$work/locale-guard.sql" | admin_sql >"$work/locale-guard.log" 2>&1
# Roles+CREATE DATABASE have an unavoidable non-atomic boundary. On failure,
# leave all partial state for review: never drop/recreate/retry automatically.
{
  printf 'BEGIN;\n%s\n' "$initial_guard"
  cat <<'SQL'
CREATE ROLE xmartmenu_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE xmartmenu_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS CONNECTION LIMIT 12;
CREATE ROLE xmartmenu_staging_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS CONNECTION LIMIT 2;
ALTER ROLE xmartmenu_staging_reader SET default_transaction_read_only=on;
DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; END IF; END $$;
COMMIT;
SQL
  cat "$work/create-database.sql"
  cat <<'SQL'
REVOKE ALL ON DATABASE xmartmenu FROM PUBLIC;
GRANT CONNECT ON DATABASE xmartmenu TO xmartmenu_runtime,xmartmenu_staging_reader;
SQL
} | admin_sql >"$work/create.log" 2>&1
empty_guard=$(cat <<'SQL'
DO $$ BEGIN
 IF current_database()<>'xmartmenu' OR current_user<>'xmartmenu_owner' OR session_user<>'xmail_owner'
 OR (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database())<>'xmartmenu_owner'
 OR current_setting('server_version_num')::int/10000<>17
 OR EXISTS(SELECT FROM pg_namespace WHERE nspname IN ('auth','supabase_migrations'))
 OR EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')
 OR EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')
 OR EXISTS(SELECT FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public')
 OR EXISTS(SELECT FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE n.nspname='public')
 THEN RAISE EXCEPTION 'Only the newly-created empty owned database is admitted'; END IF;
END $$;
SQL
)
coproc TARGET_TRANSACTION { timeout --kill-after=5s 270s docker exec -i "$target" psql -X -w -qAt -v ON_ERROR_STOP=1 -U xmail_owner -d "$database" 2>"$work/transaction.log"; }
target_pid=$TARGET_TRANSACTION_PID
exec {target_input}>&"${TARGET_TRANSACTION[1]}"; exec {target_output}<&"${TARGET_TRANSACTION[0]}"
original_input=${TARGET_TRANSACTION[1]}; original_output=${TARGET_TRANSACTION[0]}
exec {original_input}>&-; exec {original_output}<&-
{
  printf "BEGIN; SET LOCAL transaction_timeout='240s'; SET LOCAL statement_timeout='180s'; SET LOCAL lock_timeout='2s'; SET LOCAL idle_in_transaction_session_timeout='45s'; SET LOCAL maintenance_work_mem='16MB'; SET LOCAL work_mem='2MB'; SET LOCAL ROLE xmartmenu_owner;\n"
  printf "DO \$\$ BEGIN IF NOT pg_try_advisory_xact_lock(190732,4) THEN RAISE EXCEPTION 'Import already active'; END IF; END \$\$;\n"
  printf '%s\n' "$empty_guard"
  cat "$work/compatibility.sql"
  printf '\\o /dev/null\n'
  cat "$work/restore-bounded.sql"
  cat <<'SQL'
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO xmartmenu_runtime,xmartmenu_staging_reader;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO xmartmenu_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO xmartmenu_staging_reader;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO xmartmenu_runtime;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO xmartmenu_staging_reader;
GRANT EXECUTE ON FUNCTION public.create_order_with_items(jsonb,jsonb) TO xmartmenu_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE xmartmenu_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
DO $$ BEGIN IF auth.uid() IS NOT NULL OR auth.role() IS NOT NULL
 OR EXISTS(SELECT FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND c.contype='f' AND NOT c.convalidated)
 OR EXISTS(SELECT FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND (NOT i.indisvalid OR NOT i.indisready OR NOT i.indislive))
 THEN RAISE EXCEPTION 'Compatibility or validation refused'; END IF; END $$;
SQL
  printf "\\o\nSET LOCAL search_path=pg_catalog,public; SET LOCAL timezone='UTC'; SET LOCAL datestyle='ISO, YMD'; SET LOCAL extra_float_digits=3; SET LOCAL bytea_output='hex';\n"
  cat "$work/manifest.sql"; printf ';\n'
  cat "$work/text-columns.sql"; printf ';\n'
  cat "$work/text-semantics.sql"; printf ';\n\\echo XMARK_READY\n'
} >&"$target_input"
IFS= read -r -t 180 target_manifest <&"$target_output"
[[ $target_manifest == \{* && ${#target_manifest} -le 64000 ]] || exit 2
IFS= read -r -t 30 target_columns <&"$target_output"
[[ $target_columns == \[* && ${#target_columns} -le 524288 ]] || exit 2
IFS= read -r -t 60 target_semantics <&"$target_output"
[[ $target_semantics == \{* && ${#target_semantics} -le 524288 ]] || exit 2
IFS= read -r -t 5 marker <&"$target_output"; [[ $marker == XMARK_READY ]] || exit 2
printf '%s\n' "$target_columns" >"$work/target-text-columns.json"
printf '%s\n' "$target_semantics" >"$work/target-text-semantics.json"
unset target_columns target_semantics
printf '%s\n' "$target_manifest" >"$work/target-manifest.json"; unset target_manifest
run_helper compare >"$work/compare.log" 2>&1
install -m 0600 "$work/target-manifest.json" "$backup_dir/pending-manifest.json"
for file in target-text-columns.json target-text-semantics.json; do
  install -m 0600 "$work/$file" "$backup_dir/pending-$file"
done
printf '%s\n' '{"state":"matched_pending_commit","database":"xmartmenu","applicationCutover":false}' >"$backup_dir/pending.json"
sync -f "$backup_dir/pending.json"; sync -f "$backup_dir"
printf 'COMMIT;\n\\echo XMARK_COMMITTED\n' >&"$target_input"
exec {target_input}>&-; target_input=''
IFS= read -r -t 15 marker <&"$target_output"; [[ $marker == XMARK_COMMITTED ]] || exit 2
wait "$target_pid"; target_pid=''; exec {target_output}<&-; target_output=''; committed=true
printf '%s\n' '{"state":"commit_acknowledged","postCommitReconciliation":"pending"}' >"$backup_dir/commit-ack.json"; sync -f "$backup_dir/commit-ack.json"
{
  printf "BEGIN READ ONLY; SET LOCAL ROLE xmartmenu_owner; SET LOCAL search_path=pg_catalog,public; SET LOCAL timezone='UTC'; SET LOCAL datestyle='ISO, YMD'; SET LOCAL extra_float_digits=3; SET LOCAL bytea_output='hex'; SET LOCAL statement_timeout='30s';\n"
  cat "$work/manifest.sql"; printf ';\n'
  cat "$work/text-columns.sql"; printf ';\n'
  cat "$work/text-semantics.sql"; printf ';\nROLLBACK;\n'
} | timeout 40s docker exec -i "$target" psql -X -w -qAt -v ON_ERROR_STOP=1 -U xmail_owner -d "$database" >"$work/committed-proofs.jsonl" 2>"$work/postcommit.log"
sed -n '1p' "$work/committed-proofs.jsonl" >"$work/target-manifest.json"
sed -n '2p' "$work/committed-proofs.jsonl" >"$work/target-text-columns.json"
sed -n '3p' "$work/committed-proofs.jsonl" >"$work/target-text-semantics.json"
[[ $(wc -l <"$work/committed-proofs.jsonl") == 3 ]] || exit 2
run_helper compare >"$work/postcommit-compare.log" 2>&1
printf '%s\n' "$xmail_proof" | timeout 30s docker exec -i "$target" psql -X -w -qAt -v ON_ERROR_STOP=1 -U xmail_owner -d xmail >"$work/xmail-after.json" 2>"$work/xmail-after.log"
cmp -s "$work/xmail-before.json" "$work/xmail-after.json"
assert_target
install -m 0600 "$work/target-manifest.json" "$backup_dir/committed-manifest.json"
for file in target-text-columns.json target-text-semantics.json; do
  install -m 0600 "$work/$file" "$backup_dir/committed-$file"
done
run_helper report >"$backup_dir/restore-proof.json" 2>"$work/report.log"
sync -f "$backup_dir/restore-proof.json"; sync -f "$backup_dir"
final_report=$(cat "$backup_dir/restore-proof.json")
cleanup
[[ $committed == true && ! -e $work && -z $(docker ps -aq --filter "label=$label_key=$nonce") ]] || exit 2
trap - EXIT
printf '%s\n' "$final_report"
