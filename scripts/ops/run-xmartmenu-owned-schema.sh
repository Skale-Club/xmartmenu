#!/usr/bin/env bash
# Runner-side launcher for owned schema changes (docs/owned-schema/*.sql). Ships the operator and the
# files to the PostgreSQL host over SSH and runs it there as root, like the final cutover.
#
#   run-xmartmenu-owned-schema.sh <plan|apply> <40-char-sha>
#
# Only the CUTOVER_SSH_* secrets are used; they never reach the host's command line.
set -Eeuo pipefail
set +x
mode="${1:?mode}"; sha="${2:?sha}"
if [[ ! $mode =~ ^(plan|apply)$ || ! $sha =~ ^[0-9a-f]{40}$ ]]; then
  echo "xmartmenu-owned-schema check=arguments status=refused"; exit 2
fi
if [[ -z ${CUTOVER_SSH_HOST:-} || -z ${CUTOVER_SSH_KEY:-} || -z ${CUTOVER_SSH_HOST_KEY:-} ]]; then
  echo "xmartmenu-owned-schema phase=${mode} status=refused check=ssh-secrets-missing"; exit 2
fi

work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
chmod 700 "$work"
mkdir -p "$work/bundle/schema"
cp scripts/ops/xmartmenu-owned-schema.py "$work/bundle/"
cp docs/owned-schema/*.sql "$work/bundle/schema/"
python3 - "$work/bundle" <<'PY'
import hashlib, json, pathlib, sys
b = pathlib.Path(sys.argv[1])
(b / 'bundle.json').write_text(json.dumps({'files': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((b / 'schema').glob('*.sql'))}}))
PY
tar -C "$work/bundle" -czf "$work/bundle.tgz" .

install -m 600 /dev/null "$work/key"; printf '%s\n' "$CUTOVER_SSH_KEY" > "$work/key"
printf '%s %s\n' "$CUTOVER_SSH_HOST" "$CUTOVER_SSH_HOST_KEY" > "$work/known_hosts"
ssh_opts=(-i "$work/key" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$work/known_hosts" -o BatchMode=yes -o ServerAliveInterval=15)
remote="root@${CUTOVER_SSH_HOST}"
run="${GITHUB_RUN_ID:-manual}-${sha:0:8}"
dir="/opt/xmartmenu/owned-schema/code/${run}"

ssh "${ssh_opts[@]}" "$remote" "umask 077; mkdir -p /opt/xmartmenu/owned-schema/code && rm -rf '$dir' && mkdir -m 700 '$dir' && tar -xz -C '$dir'" < "$work/bundle.tgz"
ssh "${ssh_opts[@]}" "$remote" "python3 -I '$dir/xmartmenu-owned-schema.py' --mode $mode --bundle '$dir' --run '$run'"
