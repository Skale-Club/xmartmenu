/**
 * xphere-mapping-check.ts - Offline gate for the pure Xphere mapper.
 *
 * v2.4 FND-02 / 2026-06-21 realignment: exercises the pure
 * `src/lib/xphere/mapping.ts` against fixture rows with NO QStash, NO Xphere
 * credentials, and NO network, asserting the generic `/api/v1/sync` `company`
 * envelope. Matches the `npx tsx scripts/*.ts` convention (no vitest).
 *
 * Locks the riskiest correctness decisions behind a runnable gate: the
 * idempotency key (company.id = tenant.id), the stage model (XPHERE_STAGES),
 * normalized MRR, the owner-email pass-through, and the note dedup fallback.
 *
 * Run: npx tsx scripts/xphere-mapping-check.ts
 *
 * Code + comments in English.
 */

import assert from 'node:assert/strict'
import {
  buildSyncPayload,
  normalizeMrr,
  selectStage,
  type SyncMapInput,
} from '@/lib/xphere/mapping'
import { XPHERE_STAGES, XPHERE_PIPELINE } from '@/lib/xphere/types'

// --- Fixtures -------------------------------------------------------------

const tenant = {
  id: 'tenant-uuid-123',
  slug: 'pizzaria-do-ze',
  name: 'Pizzaria do Zé',
  custom_domain: 'pizzariadoze.com.br' as string | null,
}

const owner = {
  full_name: 'José Silva',
  role: 'store-admin' as const,
  email: 'jose@pizzariadoze.com.br' as string | null,
}

const occurredAt = '2026-06-21T12:00:00.000Z'

const annualPlan = {
  monthly_price: 999,
  annual_price: 1200,
  billing_cycle: 'annual' as const,
  status: 'active' as const,
}

const monthlyPlan = {
  monthly_price: 49,
  annual_price: 480,
  billing_cycle: 'monthly' as const,
  status: 'active' as const,
}

// --- 1. MRR normalization -------------------------------------------------

assert.equal(
  normalizeMrr({ billing_cycle: 'annual', annual_price: 1200, monthly_price: 999 }),
  100,
  'annual MRR = annual_price / 12 = 100 (never raw monthly_price)',
)
assert.equal(
  normalizeMrr({ billing_cycle: 'monthly', annual_price: 1200, monthly_price: 49 }),
  49,
  'monthly MRR = monthly_price = 49',
)
assert.equal(normalizeMrr(annualPlan), 100, 'annual fixture MRR = 100')
assert.equal(normalizeMrr(monthlyPlan), 49, 'monthly fixture MRR = 49')

// --- 2. Stage selection (driven by XPHERE_STAGES, not literals) -----------

assert.equal(selectStage('onboarded', 'trial'), XPHERE_STAGES.ONBOARDING, 'reason onboarded -> Onboarding')
assert.equal(selectStage('plan_activated', 'active'), XPHERE_STAGES.ACTIVE, 'reason plan_activated -> Active')
assert.equal(selectStage('past_due', 'past_due'), XPHERE_STAGES.AT_RISK, 'reason past_due -> At Risk')
assert.equal(selectStage('churned', 'cancelled'), XPHERE_STAGES.CHURNED, 'reason churned -> Churned')
// reason does not pin a stage -> fall back to subscription status
assert.equal(selectStage('manual', 'active'), XPHERE_STAGES.ACTIVE, 'status active fallback -> Active')
assert.equal(selectStage('manual', 'past_due'), XPHERE_STAGES.AT_RISK, 'status past_due fallback -> At Risk')
assert.equal(selectStage('manual', 'cancelled'), XPHERE_STAGES.CHURNED, 'status cancelled fallback -> Churned')
assert.equal(selectStage('manual', 'trial'), XPHERE_STAGES.ONBOARDING, 'status trial fallback -> Onboarding')

// --- 3. Payload shape: company envelope + external_id keying --------------

const activatedInput: SyncMapInput = {
  tenant,
  owner,
  plan: annualPlan,
  currency: 'brl',
  reason: 'plan_activated',
  occurredAt,
  eventId: 'evt_stripe_abc123',
  tags: ['status:active', 'upgrade'],
}
const activated = buildSyncPayload(activatedInput)

assert.equal(activated.source, 'xmartmenu', 'payload.source = xmartmenu')
assert.equal(activated.event, 'plan_activated', 'event = reason')
assert.equal(activated.occurred_at, occurredAt, 'occurred_at passed through')

// company.id = tenant.id (the single immutable idempotency key)
assert.equal(activated.company.id, tenant.id, 'company.id = tenant.id')
assert.equal(activated.company.name, tenant.name, 'company.name from tenant')
assert.equal(activated.company.owner_name, 'José Silva', 'company.owner_name from owner')
assert.equal(activated.company.email, owner.email, 'company.email from owner (required for Contact)')
assert.equal(activated.company.website, tenant.custom_domain, 'company.website = custom_domain')
assert.equal(activated.company.custom_fields?.slug, tenant.slug, 'slug carried in custom_fields')
assert.deepEqual(activated.company.tags, ['status:active', 'upgrade'], 'company.tags pass through (-> Contact)')

assert.equal(activated.opportunity.stage, XPHERE_STAGES.ACTIVE, 'opportunity.stage = Active')
assert.equal(activated.opportunity.value, 100, 'opportunity.value = normalized MRR')
assert.equal(activated.opportunity.currency, 'BRL', 'opportunity.currency uppercased to BRL')
assert.equal(activated.opportunity.pipeline, XPHERE_PIPELINE, 'opportunity.pipeline = XmartMenu Lifecycle')

// --- 4. Note dedup fallback -----------------------------------------------

assert.equal(activated.note?.dedup_id, 'evt_stripe_abc123', 'event-driven note dedup_id = eventId')
assert.ok(activated.note && activated.note.content.length > 0, 'event-driven note content non-empty')

const onboardingInput: SyncMapInput = {
  tenant,
  owner,
  plan: { ...monthlyPlan, status: 'trial' },
  currency: 'brl',
  reason: 'onboarded',
  occurredAt,
}
const onboarding = buildSyncPayload(onboardingInput)
assert.equal(onboarding.opportunity.stage, XPHERE_STAGES.ONBOARDING, 'onboarding stage = Onboarding')
assert.equal(onboarding.note?.dedup_id, `onboarding:${tenant.id}`, 'onboarding note dedup_id = onboarding:<tenant.id>')
assert.equal(onboarding.opportunity.value, 49, 'onboarding value = monthly MRR')

// --- Extra hardening: null owner, omitted note, determinism ---------------

const nullOwner = buildSyncPayload({ ...onboardingInput, owner: null })
assert.equal(nullOwner.company.owner_name, null, 'null owner -> company.owner_name null')
assert.equal(nullOwner.company.email, null, 'null owner -> company.email null')

const noNote = buildSyncPayload({
  tenant,
  owner,
  plan: annualPlan,
  currency: 'brl',
  reason: 'manual',
  occurredAt,
})
assert.equal(noNote.note, undefined, 'manual reason without eventId omits the note')
assert.deepEqual(noNote.company.tags, [], 'tags default to []')

assert.deepEqual(
  buildSyncPayload(activatedInput),
  buildSyncPayload(activatedInput),
  'mapper is deterministic for identical input',
)

// --- Result ---------------------------------------------------------------

console.log('xphere-mapping-check: all assertions passed')
