import { randomUUID } from 'node:crypto'
import { expect, it, vi } from 'vitest'
import { runNativeAiBilling, NATIVE_BILLING_PROVIDER_OPTIONS, type NativeBillingRepository, type NativeBillingGateway } from '@/lib/ai/native-billing'
import { BillingTenantMissingError, hashFacts, makeBillingBody, matchesBillingItem, usageFacts, type BillingProviderContext } from '@/lib/ai/native-billing-facts'
import type { NativeBillingRequest } from '@/lib/data/ai-billing'
const tenantId = randomUUID(), batchId = randomUUID(), cutoff = new Date('2026-11-01T12:00:00Z')
const context: BillingProviderContext = { accountId: 'acct_fixture', livemode: false, apiVersion: '2026-04-22.dahlia' }
const facts = usageFacts([{ id: '1', cost_usd: '0.10000000', charge_usd: '0.13000000' }])
const body = makeBillingBody({ tenantId, batchId, customer: 'cus_fixture', currency: 'brl', now: cutoff, usdToBrl: 5 }, facts)
const request: NativeBillingRequest = { batchId, tenantId, body, context, requestHash: hashFacts({ body, context }),
  ...facts, state: 'prepared', firstAttemptAt: null, leaseUntil: null, sourceEventId: null }
const item = () => ({ ...body, id: 'ii_fixture', object: 'invoiceitem', invoice: null, livemode: false })
function setup() {
  const repository: NativeBillingRepository = {
    prepare: vi.fn().mockResolvedValue({ kind: 'request', request }), claim: vi.fn().mockResolvedValue({ request, token: randomUUID() }), refuse: vi.fn().mockResolvedValue(undefined),
    finalize: vi.fn().mockResolvedValue({ billed: true, events: 1, costUsd: 0.1, chargeUsd: 0.13, amountMinor: 65, currency: 'brl', invoiceItemId: 'ii_fixture' }),
  }
  const provider: NativeBillingGateway = { context: vi.fn().mockResolvedValue(context), create: vi.fn().mockResolvedValue(item()) }
  return { repository, provider }
}
it('sends only immutable body/key with bounded requests and finalizes after the provider resolves', async () => {
  const { repository, provider } = setup()
  const output = await runNativeAiBilling({ tenantId, currency: 'usd', now: new Date('2030-01-01') }, repository, provider)
  expect(output.result.billed).toBe(true)
  expect(provider.context).toHaveBeenCalledWith(NATIVE_BILLING_PROVIDER_OPTIONS)
  expect(provider.create).toHaveBeenCalledWith(body, { timeout: 6000, maxNetworkRetries: 0, apiVersion: context.apiVersion, idempotencyKey: `ai-usage-batch-${batchId}` })
  expect(repository.finalize).toHaveBeenCalledOnce(); expect(repository.refuse).not.toHaveBeenCalled()
})
it('no-charge and duplicate receipts never reach the provider or attempt claim', async () => {
  const { repository, provider } = setup()
  vi.mocked(repository.prepare).mockResolvedValue({ kind: 'done', skipped: true, result: { billed: false, events: 0, costUsd: 0, chargeUsd: 0, amountMinor: 0, currency: 'brl' } })
  expect((await runNativeAiBilling({ tenantId }, repository, provider)).skipped).toBe(true)
  expect(provider.context).not.toHaveBeenCalled(); expect(provider.create).not.toHaveBeenCalled(); expect(repository.claim).not.toHaveBeenCalled()
})
it('context preparation rechecks SQL before claiming and may become a no-op without a charge', async () => {
  const { repository, provider } = setup()
  vi.mocked(repository.prepare).mockResolvedValueOnce({ kind: 'context' }).mockResolvedValueOnce({ kind: 'done', result: { billed: false, reason: 'nothing_to_bill', events: 0, costUsd: 0, chargeUsd: 0, amountMinor: 0, currency: 'brl' } })
  await runNativeAiBilling({ tenantId }, repository, provider)
  expect(repository.prepare).toHaveBeenLastCalledWith({ tenantId }, context); expect(provider.create).not.toHaveBeenCalled()
})
it('failed/unknown claim commits and provider-context failures refuse before any financial call', async () => {
  for (const mode of ['commit', 'context', 'expired'] as const) {
    const { repository, provider } = setup()
    if (mode === 'commit') vi.mocked(repository.claim).mockRejectedValue(new Error('unknown commit'))
    if (mode === 'context') vi.mocked(provider.context).mockRejectedValue(new Error('provider unavailable'))
    if (mode === 'expired') vi.mocked(repository.claim).mockResolvedValue(null)
    await expect(runNativeAiBilling({ tenantId }, repository, provider)).rejects.toBeTruthy()
    expect(provider.create).not.toHaveBeenCalled(); expect(repository.finalize).not.toHaveBeenCalled()
  }
})
it('a signed invoice mode differing from the actual provider account refuses before claim or create', async () => {
  const { repository, provider } = setup()
  await expect(runNativeAiBilling({ tenantId, invoiceId: 'in_fixture', event: { id: 'evt_fixture', invoiceId: 'in_fixture', subscriptionId: 'sub_fixture', livemode: true } }, repository, provider)).rejects.toMatchObject({ status: 503 })
  expect(repository.claim).not.toHaveBeenCalled(); expect(provider.create).not.toHaveBeenCalled()
})
it('a provider error marks reconciliation and never retries, releases usage or reports success', async () => {
  const { repository, provider } = setup()
  vi.mocked(provider.create).mockRejectedValue(new Error('delivery uncertain'))
  await expect(runNativeAiBilling({ tenantId }, repository, provider)).rejects.toMatchObject({ status: 503 })
  expect(provider.create).toHaveBeenCalledOnce(); expect(repository.refuse).toHaveBeenCalledOnce(); expect(repository.finalize).not.toHaveBeenCalled()
})
it('returned financial facts must all match, including expanded references and mode', async () => {
  expect(matchesBillingItem({ ...item(), customer: { id: body.customer } }, body, context)).toBe(true)
  const invoiceBody = { ...body, invoice: 'in_fixture' }
  expect(matchesBillingItem({ ...item(), invoice: { id: 'in_fixture' } }, invoiceBody, context)).toBe(true)
  for (const patch of [{ amount: 1 }, { currency: 'usd' }, { customer: 'cus_other' }, { invoice: 'in_other' }, { metadata: {} }, { livemode: true }, { description: 'changed' }, { deleted: true }, { object: 'invoice' }]) {
    const { repository, provider } = setup(); vi.mocked(provider.create).mockResolvedValue({ ...item(), ...patch })
    await expect(runNativeAiBilling({ tenantId }, repository, provider)).rejects.toMatchObject({ status: 503 })
    expect(repository.refuse).toHaveBeenCalledOnce(); expect(repository.finalize).not.toHaveBeenCalled()
  }
})
it('a failed local finalize propagates and keeps immutable request recovery instead of success', async () => {
  const { repository, provider } = setup(); vi.mocked(repository.finalize).mockRejectedValue(new Error('unknown commit'))
  await expect(runNativeAiBilling({ tenantId }, repository, provider)).rejects.toBeTruthy()
  expect(provider.create).toHaveBeenCalledOnce(); expect(repository.refuse).not.toHaveBeenCalled()
})
it('a tenant deleted after the remote effect is marked for reconciliation without a successful result', async () => {
  const { repository, provider } = setup(); vi.mocked(repository.finalize).mockRejectedValue(new BillingTenantMissingError())
  await expect(runNativeAiBilling({ tenantId }, repository, provider)).rejects.toMatchObject({ status: 503 })
  expect(provider.create).toHaveBeenCalledOnce(); expect(repository.refuse).toHaveBeenCalledOnce()
})
it('request hashing is stable across JSONB key order and binds every provider context fact', () => {
  expect(hashFacts({ context, body })).toBe(request.requestHash)
  expect(hashFacts({ body, context: { ...context, livemode: true } })).not.toBe(request.requestHash)
  expect(hashFacts({ body: { ...body, amount: 1 }, context })).not.toBe(request.requestHash)
})
it('monotonic bigint usage IDs preserve membership without unsafe integer conversions', () => {
  const value = usageFacts([{ id: '9007199254740992', cost_usd: '1', charge_usd: '2' }, { id: '9007199254740993', cost_usd: '1', charge_usd: '2' }])
  expect(value.maxEventId).toBe('9007199254740993'); expect(value.events).toBe(2)
  expect(() => usageFacts([{ id: '2', cost_usd: '1', charge_usd: '2' }, { id: '1', cost_usd: '1', charge_usd: '2' }])).toThrow()
  expect(() => usageFacts([{ id: '1', cost_usd: '-1', charge_usd: '2' }])).toThrow()
})
