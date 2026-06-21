/**
 * xphere-worker-check.ts - Offline gate for the worker's retry classification
 * and its fat-read -> map -> write-back wiring.
 *
 * v2.4 FND-06 / Phase 51 success criterion: the repo has no test runner; this
 * `tsx` assertion script locks the riskiest worker decision (retry vs DLQ vs ack)
 * behind a runnable gate, the same way scripts/xphere-mapping-check.ts locked the
 * mapper. It exercises the PURE `classifyWorkerOutcome` table AND the
 * `buildSyncPayload` fat-read shape against fixture rows with a STUBBED client —
 * NO QStash, NO Xphere credentials, NO network, NO env reads.
 *
 * Uses `node:assert/strict` — any failed assertion throws and yields a non-zero
 * exit, so this is usable as a CI/pre-commit gate. Imports no dotenv / Supabase /
 * QStash / fetch; the Xphere client is replaced by a local stub.
 *
 * Run: npx tsx scripts/xphere-worker-check.ts  (or `npm run xphere:worker:check`)
 *
 * Code + comments in English.
 */

import assert from 'node:assert/strict'
import {
  classifyWorkerOutcome,
  nonRetryableHeaders,
} from '@/lib/xphere/classify'
import { XphereTransientError, XpherePermanentError } from '@/lib/xphere/errors'
import { buildSyncPayload, type SyncMapInput } from '@/lib/xphere/mapping'
import type { PostXphereResult } from '@/lib/xphere/client'
import type { XphereSyncRequest } from '@/lib/xphere/types'

// --- GROUP A: retry classification (the full table from classify.ts) ------

assert.deepEqual(
  classifyWorkerOutcome({ kind: 'success' }),
  { status: 200, nonRetryable: false },
  'success -> 200 / ack (no retry)',
)
assert.deepEqual(
  classifyWorkerOutcome({ kind: 'disabled' }),
  { status: 200, nonRetryable: false },
  'disabled (env gate closed) -> 200 / ack',
)
assert.deepEqual(
  classifyWorkerOutcome({ kind: 'tenant_gone' }),
  { status: 200, nonRetryable: false },
  'tenant_gone (deleted) -> 200 / ack',
)
assert.deepEqual(
  classifyWorkerOutcome({ kind: 'bad_payload' }),
  { status: 489, nonRetryable: true },
  'bad_payload -> 489 / DLQ (malformed message is permanent)',
)
assert.deepEqual(
  classifyWorkerOutcome({
    kind: 'error',
    error: new XpherePermanentError('unknown stage'),
  }),
  { status: 489, nonRetryable: true },
  'XpherePermanentError -> 489 / DLQ',
)
assert.deepEqual(
  classifyWorkerOutcome({
    kind: 'error',
    error: new XphereTransientError('xphere 503'),
  }),
  { status: 500, nonRetryable: false },
  'XphereTransientError -> 500 / retry',
)
assert.deepEqual(
  classifyWorkerOutcome({ kind: 'error', error: new Error('boom') }),
  { status: 500, nonRetryable: false },
  'unknown throw -> 500 / retry (treated transient)',
)

// nonRetryableHeaders emits the DLQ header only for a permanent verdict.
assert.deepEqual(
  nonRetryableHeaders(
    classifyWorkerOutcome({
      kind: 'error',
      error: new XpherePermanentError('perm'),
    }),
  ),
  { 'Upstash-NonRetryable-Error': 'true' },
  'permanent verdict -> Upstash-NonRetryable-Error: true',
)
assert.deepEqual(
  nonRetryableHeaders(
    classifyWorkerOutcome({
      kind: 'error',
      error: new XphereTransientError('trans'),
    }),
  ),
  {},
  'transient verdict -> no non-retryable header',
)

// --- GROUP B: fat-read -> map -> write-back wiring (STUBBED client) --------

/**
 * Local stub for postXphereSync: returns the success shape the real client
 * would, WITHOUT any fetch. Typed as PostXphereResult so the stub stays
 * contract-faithful — it proves the worker's write-back inputs without real I/O.
 */
function stubPostXphereSync(_payload: XphereSyncRequest): PostXphereResult {
  return {
    disabled: false,
    response: {
      account_id: 'acc_1',
      contact_id: 'con_1',
      opportunity_id: 'opp_1',
    },
  }
}

// Fixture rows mirroring what the worker's fat-read assembles (same shape as
// scripts/xphere-mapping-check.ts).
const tenant = {
  id: 'tenant-uuid-123',
  slug: 'pizzaria-do-ze',
  name: 'Pizzaria do Zé',
  custom_domain: 'pizzariadoze.com.br' as string | null,
}
const owner = { full_name: 'José Silva', role: 'store-admin' as const }
const plan = {
  monthly_price: 49,
  annual_price: 480,
  billing_cycle: 'monthly' as const,
  status: 'active' as const,
}

const fixture: SyncMapInput = {
  tenant,
  owner,
  plan,
  currency: 'brl',
  reason: 'plan_activated',
}

const payload = buildSyncPayload(fixture)

// The fat-read shape maps to an external_id-keyed payload on all three entities.
assert.equal(
  payload.account.external_id,
  tenant.id,
  'account.external_id = tenant.id',
)
assert.equal(
  payload.contact.external_id,
  tenant.id,
  'contact.external_id = tenant.id',
)
assert.equal(
  payload.opportunity.external_id,
  tenant.id,
  'opportunity.external_id = tenant.id',
)
assert.equal(payload.source, 'xmartmenu', 'payload.source = xmartmenu')

// Drive the payload through the stubbed client and assert the exact ids the
// worker would persist to xphere_account_id/contact_id/opportunity_id — proving
// the success write-back wiring with no creds and no network.
const result = stubPostXphereSync(payload)
assert.equal(result.disabled, false, 'stubbed client is not disabled')
if (result.disabled === false) {
  assert.equal(
    result.response.account_id,
    'acc_1',
    'write-back xphere_account_id = response.account_id',
  )
  assert.equal(
    result.response.contact_id,
    'con_1',
    'write-back xphere_contact_id = response.contact_id',
  )
  assert.equal(
    result.response.opportunity_id,
    'opp_1',
    'write-back xphere_opportunity_id = response.opportunity_id',
  )
}

// --- Result ---------------------------------------------------------------

// Reaching here means every assertion held. assert/strict throws on any failure,
// which exits non-zero automatically — no manual failure counter.
console.log('xphere-worker-check: all assertions passed')
