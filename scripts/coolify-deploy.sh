#!/usr/bin/env bash
# Deploy one exact image to Coolify and prove production serves it.
#
#   scripts/coolify-deploy.sh <git-sha>
#
# Env: COOLIFY_TOKEN, COOLIFY_BASE, APP_UUID, PUBLIC_URL, optional IMAGE_REPOSITORY.
#
# Compose runs the pinned repository and SHA (legacy package remains rollback-compatible).
# Setting IMAGE_TAG to the commit SHA before deploying means a later push to
# :latest can never slip a different, unvalidated build into this deploy, and
# a rollback is the same call with an older SHA.
set -euo pipefail

SHA="${1:?usage: coolify-deploy.sh <git-sha>}"
IMAGE_REPOSITORY="${IMAGE_REPOSITORY:-${IMAGE_NAME:-ghcr.io/skale-club/xprout}}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "::error::Expected a full commit SHA."; exit 1; }
case "$IMAGE_REPOSITORY" in
  ghcr.io/skale-club/xprout|ghcr.io/skale-club/xmartmenu) ;;
  *) echo "::error::Unreviewed image repository."; exit 1 ;;
esac
: "${COOLIFY_TOKEN:?}" "${COOLIFY_BASE:?}" "${APP_UUID:?}" "${PUBLIC_URL:?}"

api() {
  curl --fail-with-body -sS --retry 3 --retry-all-errors \
    -H "Authorization: Bearer ${COOLIFY_TOKEN}" -H 'Content-Type: application/json' "$@"
}

# The final cutover operation sets XM_CUTOVER_ACTIVE while it owns the app; a normal deploy must wait.
if api "${COOLIFY_BASE}/api/v1/applications/${APP_UUID}/envs" | jq -e '[.[] | select(.key == "XM_CUTOVER_ACTIVE")] | length > 0' >/dev/null; then
  echo "::error::The final cutover operation is active (XM_CUTOVER_ACTIVE); not deploying."
  exit 1
fi

# Pin both coordinates: rolling back a legacy-only SHA must not pull it from the new package.
for key in IMAGE_REPOSITORY IMAGE_TAG; do
  if [[ "$key" == IMAGE_TAG ]]; then expected="$SHA"; else expected="$IMAGE_REPOSITORY"; fi
  payload="$(jq -nc --arg key "$key" --arg v "$expected" '{key: $key, value: $v}')"
  if ! api -X PATCH "${COOLIFY_BASE}/api/v1/applications/${APP_UUID}/envs" -d "$payload" >/dev/null; then
    # Readback, rather than retrying a possibly successful create, avoids duplicates.
    api -X POST "${COOLIFY_BASE}/api/v1/applications/${APP_UUID}/envs" -d "$payload" >/dev/null || true
  fi
  current="$(api "${COOLIFY_BASE}/api/v1/applications/${APP_UUID}/envs" \
    | jq -r --arg key "$key" '[.[] | select(.key == $key and (.is_preview | not))][0].value // empty')"
  if [[ "$current" != "$expected" ]]; then
    echo "::error::${key} readback does not match the reviewed image."
    exit 1
  fi
done

echo "Triggering Coolify deploy for ${APP_UUID}"
deploy_response="$(api -X POST "${COOLIFY_BASE}/api/v1/deploy?uuid=${APP_UUID}")"
deployment_uuid="$(jq -r '.deployments[0].deployment_uuid // empty' <<<"${deploy_response}")"
if [ -z "${deployment_uuid}" ]; then
  echo "::error::Coolify did not return a deployment UUID: ${deploy_response}"
  exit 1
fi

# Up to 15 minutes (180 x 5 s). 5 minutes was too short: on 2026-11-12 Coolify
# finished deploy daf8169 27 s after the old limit and the run showed red.
wait_attempts="${COOLIFY_WAIT_ATTEMPTS:-180}"
for attempt in $(seq 1 "${wait_attempts}"); do
  status="$(api "${COOLIFY_BASE}/api/v1/deployments/${deployment_uuid}" | jq -r '.status // empty')"
  echo "Coolify status (${attempt}/${wait_attempts}): ${status:-unknown}"
  case "${status}" in
    finished) break ;;
    failed|cancelled-by-user) echo "::error::Coolify deployment ${status}."; exit 1 ;;
  esac
  if [ "${attempt}" -eq "${wait_attempts}" ]; then echo "::error::Timed out waiting for Coolify after $(( wait_attempts * 5 / 60 )) minutes."; exit 1; fi
  sleep 5
done

# Healthy is not enough: the release reported by readiness must be this SHA.
for attempt in $(seq 1 24); do
  release="$(curl -sS --max-time 10 "${PUBLIC_URL}/api/health/ready" | jq -r '.release // empty' || true)"
  if [ "${release}" = "${SHA}" ]; then
    echo "Production serves ${SHA}."
    exit 0
  fi
  echo "Readiness reports release '${release:-none}' (${attempt}/24)"
  sleep 5
done
echo "::error::Production does not report release ${SHA}."
exit 1
