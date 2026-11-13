import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'
const sha = 'a'.repeat(40)
function fixture(repository, badReadback = false) {
  const dir = mkdtempSync(join(tmpdir(), 'xprout-deploy-test-'))
  const log = join(dir, 'requests.log'), env = join(dir, 'mock-env.sh')
  writeFileSync(env, `
# All external I/O is replaced before the real deploy helper starts.
curl() { printf '%s\\n' "$*" >> "$TEST_LOG"; printf '{}'; }
jq() {
  local all="$*" key="" value=""
  case "$1" in
    -e) cat >/dev/null; return 1 ;;
    -nc)
      shift
      while (( $# )); do
        if [[ "$1" == --arg ]]; then
          if [[ "$2" == key ]]; then key="$3"; else value="$3"; fi
          shift 3
        else shift; fi
      done
      printf '{"key":"%s","value":"%s"}' "$key" "$value" ;;
    -r)
      cat >/dev/null
      case "$all" in
        *--arg*IMAGE_REPOSITORY*) if [[ "$BAD_READBACK" == 1 ]]; then printf wrong; else printf '%s' "$IMAGE_REPOSITORY"; fi ;;
        *--arg*IMAGE_TAG*) printf '%s' "$TEST_SHA" ;;
        *deployment_uuid*) printf fixture-deployment ;;
        *.status*) printf finished ;;
        *.release*) printf '%s' "$TEST_SHA" ;;
        *) return 2 ;;
      esac ;;
    *) return 2 ;;
  esac
}
`)
  try {
    const result = spawnSync(bash, ['scripts/coolify-deploy.sh', sha], { encoding: 'utf8', timeout: 5000,
      env: { ...process.env, BASH_ENV: env, TEST_LOG: log, TEST_SHA: sha, BAD_READBACK: badReadback ? '1' : '0',
        IMAGE_REPOSITORY: repository, COOLIFY_TOKEN: 'offline-fixture', COOLIFY_BASE: 'https://fixture.invalid', APP_UUID: 'fixture-app', PUBLIC_URL: 'https://fixture.invalid' } })
    return { ...result, requests: readFileSync(log, 'utf8') }
  } finally {
    assert.ok(resolve(dir).startsWith(resolve(tmpdir())))
    rmSync(dir, { recursive: true, force: true })
  }
}

test('new and legacy packages pin/read back both coordinates before deploying the exact SHA', () => {
  for (const repository of ['ghcr.io/skale-club/xprout', 'ghcr.io/skale-club/xmartmenu']) {
    const result = fixture(repository)
    assert.equal(result.status, 0, result.stderr + result.stdout)
    const repoWrite = result.requests.indexOf(`{"key":"IMAGE_REPOSITORY","value":"${repository}"}`)
    const shaWrite = result.requests.indexOf(`{"key":"IMAGE_TAG","value":"${sha}"}`)
    const deploy = result.requests.indexOf('/api/v1/deploy?')
    assert.ok(repoWrite >= 0 && shaWrite > repoWrite && deploy > shaWrite)
    assert.match(result.stdout, /Production serves a{40}/)
  }
})

test('repository readback mismatch refuses before SHA pin or deployment', () => {
  const result = fixture('ghcr.io/skale-club/xprout', true)
  assert.equal(result.status, 1)
  assert.match(result.stdout, /IMAGE_REPOSITORY readback/)
  assert.doesNotMatch(result.requests, /"key":"IMAGE_TAG"|\/api\/v1\/deploy\?/)
})
