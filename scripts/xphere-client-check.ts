/**
 * xphere-client-check.ts - Offline gate for the Xphere typed errors + network seam.
 *
 * v2.4 Phase 51 / Plan 01: the repo has no test runner; this `tsx` assertion
 * script exercises `src/lib/xphere/errors.ts` and `src/lib/xphere/client.ts`
 * with NO real QStash/Xphere credentials and NO real network (fetch is stubbed
 * and env is set in-process). It matches the existing `npx tsx scripts/*.ts`
 * convention (per the CONTEXT decision — no vitest introduced), mirroring
 * scripts/xphere-mapping-check.ts.
 *
 * It locks the riskiest correctness decisions behind a runnable gate:
 *   - typed error classes carry only message + numeric status (no secrets)
 *   - the env gate (ships dark when creds absent OR XPHERE_SYNC_ENABLED falsy)
 *   - transient (5xx/429/network/timeout) vs permanent (4xx) classification
 *   - a single fetch attempt (QStash owns retries)
 *
 * Uses `node:assert/strict` — any failed assertion throws and yields a non-zero
 * exit, so this is usable as a CI/pre-commit gate.
 *
 * Run: npx tsx scripts/xphere-client-check.ts  (or `npm run xphere:check:client`)
 *
 * Code + comments in English.
 */

import assert from 'node:assert/strict'
import {
  XphereTransientError,
  XpherePermanentError,
} from '@/lib/xphere/errors'
import {
  isXphereEnabled,
  postXphereSync,
  type PostXphereResult,
} from '@/lib/xphere/client'
import type { XphereSyncRequest } from '@/lib/xphere/types'

// --- Helpers --------------------------------------------------------------

/** Minimal valid payload — exact field names are not exercised here (the seam
 *  just serializes it); shape comes from the Phase 50 contract. */
const payload: XphereSyncRequest = {
  source: 'xmartmenu',
  event: 'manual',
  occurred_at: '2026-06-21T12:00:00.000Z',
  company: {
    id: 'tenant-uuid-123',
    name: 'Pizzaria do Zé',
    owner_name: 'José',
    email: 'jose@pizzariadoze.com.br',
    website: null,
  },
  opportunity: {
    stage: 'Active',
    value: 100,
    currency: 'BRL',
    pipeline: 'XmartMenu Lifecycle',
  },
}

/** Reset env to a known-disabled baseline, then apply overrides. */
function setEnv(overrides: Record<string, string | undefined>): void {
  delete process.env.XPHERE_API_URL
  delete process.env.XPHERE_API_KEY
  delete process.env.XPHERE_ORG_ID
  delete process.env.XPHERE_SYNC_ENABLED
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
}

/** Enabled-by-default env block. */
const enabledEnv = {
  XPHERE_API_URL: 'https://xphere.example/api/v1/sync',
  XPHERE_API_KEY: 'test-key-not-a-real-secret',
  XPHERE_ORG_ID: 'org-123',
  XPHERE_SYNC_ENABLED: 'true',
}

const originalFetch = globalThis.fetch

/** Install a fake fetch and return the list of calls it recorded. */
function stubFetch(
  impl: (url: string, init: RequestInit) => Promise<Response> | Response,
): { calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = []
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString()
    calls.push({ url: u, init: init ?? {} })
    return impl(u, init ?? {})
  }) as typeof fetch
  return { calls }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function expectThrows<T>(
  fn: () => Promise<T>,
  ctor: new (...args: never[]) => Error,
  msg: string,
): Promise<Error> {
  try {
    await fn()
  } catch (err) {
    assert.ok(err instanceof ctor, `${msg} (got ${(err as Error)?.name})`)
    return err as Error
  }
  assert.fail(`${msg} — expected throw, got resolve`)
}

async function main(): Promise<void> {
// --- 1. Typed error classes ----------------------------------------------

const transient = new XphereTransientError('5xx', { status: 503 })
assert.equal(transient.name, 'XphereTransientError', 'transient.name set')
assert.ok(transient instanceof Error, 'transient instanceof Error')
assert.equal(transient.status, 503, 'transient carries numeric status')

const permanent = new XpherePermanentError('bad payload', { status: 422 })
assert.equal(permanent.name, 'XpherePermanentError', 'permanent.name set')
assert.ok(permanent instanceof Error, 'permanent instanceof Error')
assert.equal(permanent.status, 422, 'permanent carries numeric status')

// status is optional
assert.equal(
  new XphereTransientError('network').status,
  undefined,
  'status optional',
)

// --- 2. Env gate (ships dark) --------------------------------------------

setEnv({}) // nothing set
assert.equal(isXphereEnabled(), false, 'disabled when no creds')

setEnv({ XPHERE_API_URL: enabledEnv.XPHERE_API_URL }) // url only
assert.equal(isXphereEnabled(), false, 'disabled when key missing')

setEnv({ ...enabledEnv, XPHERE_SYNC_ENABLED: 'false' }) // kill switch off
assert.equal(isXphereEnabled(), false, 'disabled when kill switch = false')

setEnv({ ...enabledEnv, XPHERE_SYNC_ENABLED: undefined }) // creds but no switch
assert.equal(isXphereEnabled(), false, 'disabled when kill switch unset')

setEnv(enabledEnv)
assert.equal(isXphereEnabled(), true, 'enabled when creds + switch=true')

// disabled path performs NO fetch and returns the typed sentinel
{
  setEnv({}) // dark
  const { calls } = stubFetch(() => {
    throw new Error('fetch must not be called when disabled')
  })
  const result: PostXphereResult = await postXphereSync(payload)
  assert.deepEqual(result, { disabled: true }, 'disabled -> { disabled: true }')
  assert.equal(calls.length, 0, 'disabled -> zero fetch calls')
  globalThis.fetch = originalFetch
}

// --- 3. Success path ------------------------------------------------------

{
  setEnv(enabledEnv)
  const { calls } = stubFetch(() =>
    jsonResponse(200, {
      account_id: 'a1',
      contact_id: 'c1',
      opportunity_id: 'o1',
    }),
  )
  const result = await postXphereSync(payload, { idempotencyKey: 'tenant:manual' })
  assert.equal(result.disabled, false, 'enabled success -> disabled:false')
  if (result.disabled === false) {
    assert.equal(result.response.account_id, 'a1', 'returns account_id')
    assert.equal(result.response.opportunity_id, 'o1', 'returns opportunity_id')
  }
  assert.equal(calls.length, 1, 'exactly one fetch attempt (no retry loop)')
  const init = calls[0]!.init
  assert.equal(init.method, 'POST', 'POST method')
  const headers = init.headers as Record<string, string>
  assert.equal(
    headers['Authorization'],
    `Bearer ${enabledEnv.XPHERE_API_KEY}`,
    'Bearer auth header',
  )
  assert.equal(headers['X-Org-Id'], enabledEnv.XPHERE_ORG_ID, 'org id header')
  assert.equal(
    headers['Idempotency-Key'],
    'tenant:manual',
    'idempotency key header when provided',
  )
  assert.ok(init.signal, 'request carries an abort signal (timeout)')
  globalThis.fetch = originalFetch
}

// --- 4. Transient classification (retry -> QStash) ------------------------

for (const status of [500, 502, 503, 429]) {
  setEnv(enabledEnv)
  stubFetch(() => jsonResponse(status, { error: 'boom' }))
  const err = await expectThrows(
    () => postXphereSync(payload),
    XphereTransientError,
    `status ${status} -> XphereTransientError`,
  )
  assert.equal(
    (err as XphereTransientError).status,
    status,
    `transient carries status ${status}`,
  )
  globalThis.fetch = originalFetch
}

// network failure -> transient
{
  setEnv(enabledEnv)
  stubFetch(() => {
    throw new TypeError('network down')
  })
  await expectThrows(
    () => postXphereSync(payload),
    XphereTransientError,
    'network error -> XphereTransientError',
  )
  globalThis.fetch = originalFetch
}

// abort/timeout -> transient
{
  setEnv(enabledEnv)
  stubFetch(() => {
    const e = new Error('aborted')
    e.name = 'TimeoutError'
    throw e
  })
  await expectThrows(
    () => postXphereSync(payload),
    XphereTransientError,
    'timeout abort -> XphereTransientError',
  )
  globalThis.fetch = originalFetch
}

// --- 5. Permanent classification (DLQ) ------------------------------------

for (const status of [400, 401, 403, 422]) {
  setEnv(enabledEnv)
  stubFetch(() => jsonResponse(status, { error: 'nope' }))
  const err = await expectThrows(
    () => postXphereSync(payload),
    XpherePermanentError,
    `status ${status} -> XpherePermanentError`,
  )
  assert.equal(
    (err as XpherePermanentError).status,
    status,
    `permanent carries status ${status}`,
  )
  globalThis.fetch = originalFetch
}

// --- Result ---------------------------------------------------------------

globalThis.fetch = originalFetch
console.log('xphere-client-check: all assertions passed')
}

main().catch((err) => {
  globalThis.fetch = originalFetch
  console.error(err)
  process.exit(1)
})
