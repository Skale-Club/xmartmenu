/**
 * xphere-mapping-check.ts - Offline gate for the pure Xphere mapper.
 *
 * v2.4 FND-02 / Phase 50 success criterion 4: the repo has no test runner; this
 * `tsx` assertion script exercises the pure `src/lib/xphere/mapping.ts` against
 * fixture rows with NO QStash, NO Xphere credentials, and NO network. It matches
 * the existing `npx tsx scripts/*.ts` convention (per the CONTEXT decision — no
 * vitest introduced).
 *
 * It locks the riskiest correctness decisions behind a runnable gate: the
 * idempotency key (external_id = tenant.id), the stage model (XPHERE_STAGES),
 * normalized MRR, and the note dedup fallback.
 *
 * Uses `node:assert/strict` — any failed assertion throws and yields a non-zero
 * exit, so this is usable as a CI/pre-commit gate (not a manual eyeball). Reads
 * no env vars and imports no dotenv / Supabase / QStash / fetch module.
 *
 * Run: npx tsx scripts/xphere-mapping-check.ts  (or `npm run xphere:check`)
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
import { XPHERE_STAGES } from '@/lib/xphere/types'

// --- Fixtures -------------------------------------------------------------

const tenant = {
  id: 'tenant-uuid-123',
  slug: 'pizzaria-do-ze',
  name: 'Pizzaria do Zé',
  custom_domain: 'pizzariadoze.com.br' as string | null,
}

const owner = { full_name: 'José Silva', role: 'store-admin' as const }

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
  normalizeMrr({
    billing_cycle: 'annual',
    annual_price: 1200,
    monthly_price: 999,
    status: 'active',
  }),
  100,
  'annual MRR = annual_price / 12 = 100 (never raw monthly_price)',
)
assert.equal(
  normalizeMrr({
    billing_cycle: 'monthly',
    annual_price: 1200,
    monthly_price: 49,
    status: 'active',
  }),
  49,
  'monthly MRR = monthly_price = 49',
)
assert.equal(normalizeMrr(annualPlan), 100, 'annual fixture MRR = 100')
assert.equal(normalizeMrr(monthlyPlan), 49, 'monthly fixture MRR = 49')

// --- 2. Stage selection (driven by XPHERE_STAGES, not literals) -----------

// reason takes priority over status
assert.equal(
  selectStage('onboarded', 'trial'),
  XPHERE_STAGES.ONBOARDING,
  'reason onboarded -> Onboarding',
)
assert.equal(
  selectStage('plan_activated', 'active'),
  XPHERE_STAGES.ACTIVE,
  'reason plan_activated -> Active',
)
assert.equal(
  selectStage('past_due', 'past_due'),
  XPHERE_STAGES.AT_RISK,
  'reason past_due -> At Risk',
)
assert.equal(
  selectStage('churned', 'cancelled'),
  XPHERE_STAGES.CHURNED,
  'reason churned -> Churned',
)
// reason does not pin a stage -> fall back to subscription status
assert.equal(
  selectStage('manual', 'active'),
  XPHERE_STAGES.ACTIVE,
  'status active fallback -> Active',
)
assert.equal(
  selectStage('manual', 'past_due'),
  XPHERE_STAGES.AT_RISK,
  'status past_due fallback -> At Risk',
)
assert.equal(
  selectStage('manual', 'cancelled'),
  XPHERE_STAGES.CHURNED,
  'status cancelled fallback -> Churned',
)
assert.equal(
  selectStage('manual', 'trial'),
  XPHERE_STAGES.ONBOARDING,
  'status trial fallback -> Onboarding',
)

// --- 3. Payload shape + external_id keying --------------------------------

const activatedInput: SyncMapInput = {
  tenant,
  owner,
  plan: annualPlan,
  currency: 'brl',
  reason: 'plan_activated',
  eventId: 'evt_stripe_abc123',
  tags: ['status:active', 'upgrade'],
}
const activated = buildSyncPayload(activatedInput)

assert.equal(activated.source, 'xmartmenu', 'payload.source = xmartmenu')
assert.equal(activated.reason, 'plan_activated', 'reason passed through')

// external_id = tenant.id on ALL THREE entities (immutable idempotency key)
assert.equal(
  activated.account.external_id,
  tenant.id,
  'account.external_id = tenant.id',
)
assert.equal(
  activated.contact.external_id,
  tenant.id,
  'contact.external_id = tenant.id',
)
assert.equal(
  activated.opportunity.external_id,
  tenant.id,
  'opportunity.external_id = tenant.id',
)

assert.equal(activated.account.name, tenant.name, 'account.name from tenant')
assert.equal(activated.account.slug, tenant.slug, 'account.slug from tenant')
assert.equal(
  activated.account.website,
  tenant.custom_domain,
  'account.website = custom_domain',
)
assert.equal(activated.contact.role, 'store-admin', 'contact.role = store-admin')
assert.equal(activated.contact.name, 'José Silva', 'contact.name from owner')
assert.equal(
  activated.opportunity.stage,
  XPHERE_STAGES.ACTIVE,
  'opportunity.stage = Active',
)
assert.equal(activated.opportunity.amount, 100, 'opportunity.amount = normalized MRR')
assert.equal(activated.opportunity.currency, 'brl', 'opportunity.currency = brl')
assert.deepEqual(
  activated.opportunity.tags,
  ['status:active', 'upgrade'],
  'opportunity.tags passed through',
)

// --- 4. Note dedup fallback -----------------------------------------------

// event-driven reason with eventId -> dedup on the Stripe event id
assert.equal(
  activated.note?.dedup_id,
  'evt_stripe_abc123',
  'event-driven note dedup_id = eventId',
)
assert.ok(
  activated.note && activated.note.body.length > 0,
  'event-driven note body non-empty',
)

// onboarding with no eventId -> dedup on onboarding:<tenant.id>
const onboardingInput: SyncMapInput = {
  tenant,
  owner,
  plan: { ...monthlyPlan, status: 'trial' },
  currency: 'brl',
  reason: 'onboarded',
}
const onboarding = buildSyncPayload(onboardingInput)
assert.equal(
  onboarding.opportunity.stage,
  XPHERE_STAGES.ONBOARDING,
  'onboarding stage = Onboarding',
)
assert.equal(
  onboarding.note?.dedup_id,
  `onboarding:${tenant.id}`,
  'onboarding note dedup_id = onboarding:<tenant.id>',
)
assert.equal(onboarding.opportunity.amount, 49, 'onboarding amount = monthly MRR')

// --- Extra hardening: null owner, omitted note, determinism ---------------

const nullOwner = buildSyncPayload({ ...onboardingInput, owner: null })
assert.equal(nullOwner.contact.name, null, 'null owner -> contact.name null')
assert.equal(
  nullOwner.contact.role,
  'store-admin',
  'null owner -> contact.role still store-admin',
)

const noNote = buildSyncPayload({
  tenant,
  owner,
  plan: annualPlan,
  currency: 'brl',
  reason: 'manual',
})
assert.equal(
  noNote.note,
  undefined,
  'manual reason without eventId omits the note',
)
assert.deepEqual(noNote.opportunity.tags, [], 'tags default to []')

assert.deepEqual(
  buildSyncPayload(activatedInput),
  buildSyncPayload(activatedInput),
  'mapper is deterministic for identical input',
)

// --- Result ---------------------------------------------------------------

// Reaching here means every assertion held. assert/strict throws on any
// failure, which exits non-zero automatically — no manual failure counter.
console.log('xphere-mapping-check: all assertions passed')
