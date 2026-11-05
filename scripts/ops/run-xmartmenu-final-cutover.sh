#!/usr/bin/env bash
# Runner-side launcher for the final cutover. Ships the reviewed operator and the
# proposal SQL to the PostgreSQL host over SSH and runs it there as root.
#
#   run-xmartmenu-final-cutover.sh <plan|apply|rollback> <40-char-sha> [DISCARD-<run> for a rollback that discards new writes]
#
# Secrets arrive as environment variables and travel to the host only on stdin.
set -Eeuo pipefail
set +x
mode="${1:?mode}"; sha="${2:?sha}"; discard="${3:-}"
if [[ ! $mode =~ ^(plan|apply|rollback)$ || ! $sha =~ ^[0-9a-f]{40}$ ]]; then
  echo "xmartmenu-cutover check=arguments status=refused"; exit 2
fi

work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
chmod 700 "$work"
mkdir -p "$work/bundle/proposals"
cp scripts/ops/xmartmenu-final-cutover.py "$work/bundle/"
cp docs/proposals/*-owned-only.sql "$work/bundle/proposals/"
cp supabase/migrations/20261104090000_identity_google_claims.sql "$work/bundle/proposals/"
cp scripts/ops/fixtures/supabase-prod-ca.crt "$work/bundle/supabase-ca.crt"
if [[ -f scripts/ops/import-google-subject-claims.ts ]]; then : > "$work/bundle/google-import-present"; fi
python3 - "$work/bundle" <<'PY'
import hashlib, json, pathlib, sys
b = pathlib.Path(sys.argv[1])
(b / 'bundle.json').write_text(json.dumps({'proposals': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (b / 'proposals').glob('*.sql')}}))
PY
tar -C "$work/bundle" -czf "$work/bundle.tgz" .

secrets_json="$(python3 -c "import json,os;print(json.dumps({n: os.environ.get(n,'') for n in ['COOLIFY_TOKEN','SUPABASE_SOURCE_DATABASE_URL','SUPABASE_SERVICE_ROLE_KEY','NEXT_PUBLIC_SUPABASE_URL']}))")"
extra=""; if [[ $discard =~ ^DISCARD-[0-9a-f]{12}$ ]]; then extra="--discard-new-writes $discard"; fi

if [[ -z ${CUTOVER_SSH_HOST:-} || -z ${CUTOVER_SSH_KEY:-} || -z ${CUTOVER_SSH_HOST_KEY:-} ]]; then
  echo "xmartmenu-cutover check=ssh-secrets present=false"
  echo "xmartmenu-cutover phase=${mode} status=refused ready=false blockers=ssh-secrets-missing"
  exit 2
fi

install -m 600 /dev/null "$work/key"; printf '%s\n' "$CUTOVER_SSH_KEY" > "$work/key"
printf '%s %s\n' "$CUTOVER_SSH_HOST" "$CUTOVER_SSH_HOST_KEY" > "$work/known_hosts"
ssh_opts=(-i "$work/key" -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$work/known_hosts" -o BatchMode=yes -o ServerAliveInterval=15)
remote="root@${CUTOVER_SSH_HOST}"
dir="/opt/xmartmenu/cutover/code/${GITHUB_RUN_ID:-manual}-${sha:0:8}"

ssh "${ssh_opts[@]}" "$remote" "umask 077; mkdir -p /opt/xmartmenu/cutover/code && rm -rf '$dir' && mkdir -m 700 '$dir' && tar -xz -C '$dir'" < "$work/bundle.tgz"
printf '%s' "$secrets_json" | ssh "${ssh_opts[@]}" "$remote" "python3 -I '$dir/xmartmenu-final-cutover.py' --mode $mode --image-sha $sha --bundle '$dir' $extra"
