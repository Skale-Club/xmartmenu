#!/usr/bin/env bash
# Deploy one exact image to Coolify and prove production serves it.
#
#   scripts/coolify-deploy.sh <git-sha>
#
# Env: COOLIFY_TOKEN, COOLIFY_BASE, APP_UUID, PUBLIC_URL.
#
# docker-compose.yaml runs ghcr.io/skale-club/xmartmenu:${IMAGE_TAG:-latest}.
# Setting IMAGE_TAG to the commit SHA before deploying means a later push to
# :latest can never slip a different, unvalidated build into this deploy, and
# a rollback is the same call with an older SHA.
set -euo pipefail

SHA="${1:?usage: coolify-deploy.sh <git-sha>}"
: "${COOLIFY_TOKEN:?}" "${COOLIFY_BASE:?}" "${APP_UUID:?}" "${PUBLIC_URL:?}"

api() {
  curl --fail-with-body -sS --retry 3 --retry-all-errors \
    -H "Authorization: Bearer ${COOLIFY_TOKEN}" -H 'Content-Type: application/json' "$@"
}

echo "Pinning IMAGE_TAG=${SHA}"
payload="$(jq -nc --arg v "${SHA}" '{key: "IMAGE_TAG", value: $v}')"
if ! api -X PATCH "${COOLIFY_BASE}/api/v1/applications/${APP_UUID}/envs" -d "${payload}" >/dev/null; then
  # First run: the variable does not exist yet. Coolify may answer this POST
  # with a validation error and still create the variable, so check instead of
  # retrying (a retry would create a duplicate).
  api -X POST "${COOLIFY_BASE}/api/v1/applications/${APP_UUID}/envs" -d "${payload}" >/dev/null || true
fi
current="$(api "${COOLIFY_BASE}/api/v1/applications/${APP_UUID}/envs" \
  | jq -r '[.[] | select(.key == "IMAGE_TAG" and (.is_preview | not))][0].value // empty')"
if [ "${current}" != "${SHA}" ]; then
  echo "::error::IMAGE_TAG is '${current:-unset}', expected ${SHA}."
  exit 1
fi

echo "Triggering Coolify deploy for ${APP_UUID}"
deploy_response="$(api -X POST "${COOLIFY_BASE}/api/v1/deploy?uuid=${APP_UUID}")"
deployment_uuid="$(jq -r '.deployments[0].deployment_uuid // empty' <<<"${deploy_response}")"
if [ -z "${deployment_uuid}" ]; then
  echo "::error::Coolify did not return a deployment UUID: ${deploy_response}"
  exit 1
fi

for attempt in $(seq 1 60); do
  status="$(api "${COOLIFY_BASE}/api/v1/deployments/${deployment_uuid}" | jq -r '.status // empty')"
  echo "Coolify status (${attempt}/60): ${status:-unknown}"
  case "${status}" in
    finished) break ;;
    failed|cancelled-by-user) echo "::error::Coolify deployment ${status}."; exit 1 ;;
  esac
  if [ "${attempt}" -eq 60 ]; then echo "::error::Timed out waiting for Coolify."; exit 1; fi
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
