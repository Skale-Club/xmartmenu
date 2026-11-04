import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ source: vi.fn(), prepare: vi.fn(), claim: vi.fn(), refuse: vi.fn(), finalize: vi.fn(), account: vi.fn(), balance: vi.fn(), create: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: state.source }))
vi.mock('@/lib/data/ai-billing-runtime', () => ({ ownedAiBillingRepository: { prepare: state.prepare, claim: state.claim, refuse: state.refuse, finalize: state.finalize } }))
vi.mock('@/lib/stripe', () => ({ stripe: { accounts: { retrieve: state.account }, balance: { retrieve: state.balance }, invoiceItems: { create: state.create } } }))
vi.mock('@/lib/observability/log', () => ({ log: { error: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/ai/access', () => ({ loadPlatformAiSettings: vi.fn() }))
import { billAiUsage } from '@/lib/ai/billing'
import { billOwnedAiUsage } from '@/lib/ai/native-billing'
const tenantId = randomUUID(), batchId = randomUUID(), options = { tenantId }, result = { billed: false, reason: 'nothing_to_bill' as const, events: 0, costUsd: 0, chargeUsd: 0, amountMinor: 0, currency: 'brl' }
beforeEach(() => {
  vi.stubEnv('OWNED_ADMIN_MENUS_ENABLED', 'true')
  state.prepare.mockResolvedValue({ kind: 'done', result })
})
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks() })
it('owned Bill now delegates before the Source constructor and keeps the existing result shape', async () => {
  expect(await billAiUsage(options)).toEqual(result)
  expect(state.prepare).toHaveBeenCalledWith(options); expect(state.source).not.toHaveBeenCalled(); expect(state.create).not.toHaveBeenCalled()
})
it('owned SQL refusal never calls the Source biller or reaches a financial provider', async () => {
  state.prepare.mockRejectedValue(new Error('candidate unavailable'))
  await expect(billAiUsage(options)).rejects.toThrow('candidate unavailable')
  expect(state.source).not.toHaveBeenCalled(); expect(state.create).not.toHaveBeenCalled()
})
it('actual gateway pins version, account/mode reads and create to six seconds with no SDK retries', async () => {
  const context = { accountId: 'acct_fixture', livemode: false, apiVersion: '2026-04-22.dahlia' }
  const body = { customer: 'cus_fixture', amount: 100, currency: 'brl', description: 'Usage fixture', metadata: { billing_batch: batchId, tenant_id: tenantId } }
  const request = { batchId, tenantId, body, context }
  state.prepare.mockResolvedValue({ kind: 'request', request }); state.claim.mockResolvedValue({ request, token: randomUUID() })
  state.account.mockResolvedValue({ id: context.accountId }); state.balance.mockResolvedValue({ livemode: false })
  state.create.mockResolvedValue({ ...body, id: 'ii_fixture', object: 'invoiceitem', invoice: null, livemode: false }); state.finalize.mockResolvedValue({ ...result, billed: true })
  await billOwnedAiUsage(options)
  const bounded = { timeout: 6000, maxNetworkRetries: 0, apiVersion: context.apiVersion }
  expect(state.account).toHaveBeenCalledWith(null, {}, bounded); expect(state.balance).toHaveBeenCalledWith({}, bounded)
  expect(state.create).toHaveBeenCalledWith(body, { ...bounded, idempotencyKey: `ai-usage-batch-${batchId}` }); expect(state.source).not.toHaveBeenCalled()
})
