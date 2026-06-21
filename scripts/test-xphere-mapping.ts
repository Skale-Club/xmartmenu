/**
 * test-xphere-mapping.ts - Offline assertions for the pure Xphere mapper.
 *
 * v2.4 FND-02: The repo has no test runner yet; this tsx assertion script
 * exercises the pure `src/lib/xphere/mapping.ts` against fixture rows with no
 * QStash/Xphere credentials and no network. Matches the existing
 * `npx tsx scripts/*.ts` convention.
 *
 * Run: npx tsx scripts/test-xphere-mapping.ts
 */

import {
  buildSyncPayload,
  normalizeMrr,
  selectStage,
  type SyncMapInput,
} from '@/lib/xphere/mapping'
import { XPHERE_STAGES } from '@/lib/xphere/types'

let failures = 0

function assert(label: string, cond: boolean): void {
  if (cond) {
    console.log(`  PASS: ${label}`)
  } else {
    failures++
    console.error(`  FAIL: ${label}`)
  }
}

function assertEqual<T>(label: string, actual: T, expected: T): void {
  assert(
    `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
    actual === expected,
  )
}

// --- Fixtures -------------------------------------------------------------

const tenant = {
  id: 'tenant-uuid-123',
  slug: 'pizzaria-do-ze',
  name: 'Pizzaria do Zé',
  custom_domain: 'pizzariadoze.com.br' as string | null,
}

const owner = { full_name: 'José Silva', role: 'store-admin' as const }

const annualPlan = {
  monthly_price: 49,
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

// --- normalizeMrr ---------------------------------------------------------

console.log('normalizeMrr:')
assertEqual('annual 1200/12 -> 100', normalizeMrr(annualPlan), 100)
assertEqual('monthly -> 49', normalizeMrr(monthlyPlan), 49)

// --- selectStage (reason priority, then status fallback) ------------------

console.log('selectStage:')
assertEqual(
  'onboarded -> Onboarding',
  selectStage('onboarded', 'active'),
  XPHERE_STAGES.ONBOARDING,
)
assertEqual(
  'plan_activated -> Active',
  selectStage('plan_activated', 'trial'),
  XPHERE_STAGES.ACTIVE,
)
assertEqual(
  'past_due reason -> At Risk',
  selectStage('past_due', 'active'),
  XPHERE_STAGES.AT_RISK,
)
assertEqual(
  'churned reason -> Churned',
  selectStage('churned', 'active'),
  XPHERE_STAGES.CHURNED,
)
assertEqual(
  'status active fallback -> Active',
  selectStage('manual', 'active'),
  XPHERE_STAGES.ACTIVE,
)
assertEqual(
  'status past_due fallback -> At Risk',
  selectStage('manual', 'past_due'),
  XPHERE_STAGES.AT_RISK,
)
assertEqual(
  'status cancelled fallback -> Churned',
  selectStage('manual', 'cancelled'),
  XPHERE_STAGES.CHURNED,
)
assertEqual(
  'status trial fallback -> Onboarding',
  selectStage('manual', 'trial'),
  XPHERE_STAGES.ONBOARDING,
)

// --- buildSyncPayload -----------------------------------------------------

console.log('buildSyncPayload:')

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

assertEqual('source is xmartmenu', activated.source, 'xmartmenu')
assertEqual('reason passed through', activated.reason, 'plan_activated')
assertEqual('account.external_id = tenant.id', activated.account.external_id, tenant.id)
assertEqual('contact.external_id = tenant.id', activated.contact.external_id, tenant.id)
assertEqual(
  'opportunity.external_id = tenant.id',
  activated.opportunity.external_id,
  tenant.id,
)
assertEqual('account.name', activated.account.name, tenant.name)
assertEqual('account.slug', activated.account.slug, tenant.slug)
assertEqual('account.website = custom_domain', activated.account.website, tenant.custom_domain)
assertEqual('contact.role store-admin', activated.contact.role, 'store-admin')
assertEqual('contact.name from owner', activated.contact.name, 'José Silva')
assertEqual('opportunity.amount = normalized MRR', activated.opportunity.amount, 100)
assertEqual('opportunity.currency passthrough', activated.opportunity.currency, 'brl')
assertEqual('opportunity.stage Active', activated.opportunity.stage, XPHERE_STAGES.ACTIVE)
assert('tags passed through', JSON.stringify(activated.opportunity.tags) === JSON.stringify(['status:active', 'upgrade']))
assertEqual('note.dedup_id = eventId', activated.note?.dedup_id, 'evt_stripe_abc123')
assert('note.body non-empty', !!activated.note && activated.note.body.length > 0)

// onboarding: no eventId -> dedup_id = onboarding:<tenant.id>
const onboardingInput: SyncMapInput = {
  tenant,
  owner,
  plan: { ...monthlyPlan, status: 'trial' },
  currency: 'brl',
  reason: 'onboarded',
}
const onboarding = buildSyncPayload(onboardingInput)
assertEqual('onboarding stage Onboarding', onboarding.opportunity.stage, XPHERE_STAGES.ONBOARDING)
assertEqual(
  'onboarding dedup_id = onboarding:<id>',
  onboarding.note?.dedup_id,
  `onboarding:${tenant.id}`,
)
assertEqual('onboarding amount monthly', onboarding.opportunity.amount, 49)

// null owner tolerated
const nullOwner = buildSyncPayload({ ...onboardingInput, owner: null })
assertEqual('null owner -> contact.name null', nullOwner.contact.name, null)
assertEqual('null owner -> contact.role still store-admin', nullOwner.contact.role, 'store-admin')

// no eventId + non-onboarded reason -> note omitted, tags default []
const noNote = buildSyncPayload({
  tenant,
  owner,
  plan: annualPlan,
  currency: 'brl',
  reason: 'manual',
})
assert('manual without eventId omits note', noNote.note === undefined)
assert('tags default to []', JSON.stringify(noNote.opportunity.tags) === '[]')

// determinism: same input -> identical output
assert(
  'deterministic output',
  JSON.stringify(buildSyncPayload(activatedInput)) === JSON.stringify(buildSyncPayload(activatedInput)),
)

// --- Result ---------------------------------------------------------------

if (failures > 0) {
  console.error(`\n${failures} assertion(s) FAILED`)
  process.exit(1)
}
console.log('\nAll Xphere mapping assertions passed.')
