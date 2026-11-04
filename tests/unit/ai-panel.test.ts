import { randomBytes, randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { decryptApiKey, encryptApiKey } from '@/lib/crypto'
import { readAiUsageSummary, writeAiPlatformSettings, writeAiTenantSettings } from '@/lib/data/ai-panel'
import { nextStoredKey } from '@/lib/ai/settings-key'
const tenantId = randomUUID(), actorId = randomUUID()
const owner = { actorId, tenantId, role: 'store-admin' as const }, global = { actorId, role: 'superadmin' as const }
const profile = (role = 'store-admin') => ({ id: actorId, role, tenant_id: role === 'superadmin' ? null : tenantId, must_change_password: false, disabled_at: null })
beforeEach(() => { vi.stubEnv('CHAT_ADDON_ENCRYPTION_KEY', randomBytes(32).toString('hex')) })
afterEach(() => vi.unstubAllEnvs())
it('masked/omitted keys preserve, empty/null remove and new values encrypt with the existing server format', () => {
  const value = randomUUID(), encrypted = nextStoredKey(value)
  expect(encrypted).not.toBe(value); expect(decryptApiKey(encrypted!)).toBe(value)
  expect(nextStoredKey('aaaa••••bbbb')).toBeUndefined(); expect(nextStoredKey(undefined)).toBeUndefined(); expect(nextStoredKey(null)).toBeNull(); expect(nextStoredKey('  ')).toBeNull()
})
it('owner key update binds the real tenant and ignores requested markup/mode/tenant overrides', async () => {
  const query = vi.fn().mockResolvedValueOnce({ rows: [profile()] }).mockResolvedValue({ rows: [] }), value = randomUUID()
  await writeAiTenantSettings(query, owner, { openrouter_api_key: value, tenant_id: randomUUID(), markup_pct: 900, billing_mode: 'included' }, true)
  const [sql, values] = query.mock.calls[1]
  expect(values[0]).toBe(tenantId); expect(sql).not.toContain('markup_pct'); expect(values).toContain('own_key'); expect(values).not.toContain(value)
  const keyIndex = sql.slice(sql.indexOf('(tenant_id,') + 1, sql.indexOf(') VALUES')).split(',').indexOf('openrouter_api_key')
  expect(decryptApiKey(values[keyIndex])).toBe(value)
})
it('an owner masked-key no-op does not reset warnings or change the stored billing mode', async () => {
  const query = vi.fn().mockResolvedValue({ rows: [profile()] })
  await writeAiTenantSettings(query, owner, { openrouter_api_key: 'aaaa••••bbbb', billing_mode: 'included' }, true)
  expect(query).toHaveBeenCalledTimes(1)
})
it('global settings require current superadmin authority and preserve omitted key columns', async () => {
  const denied = vi.fn().mockResolvedValue({ rows: [profile()] })
  await expect(writeAiPlatformSettings(denied, owner, {})).rejects.toMatchObject({ status: 403 }); expect(denied).not.toHaveBeenCalled()
  const query = vi.fn().mockResolvedValueOnce({ rows: [profile('superadmin')] }).mockResolvedValue({ rows: [] })
  await writeAiPlatformSettings(query, global, { default_billing_mode: 'included', default_markup_pct: 12.5, usd_to_brl: 5.75 })
  expect(query.mock.calls[1][0]).not.toContain('openrouter_api_key'); expect(query.mock.calls[1][1]).toContain(5.75)
})
it('superadmin tenant changes validate mode/margin before a write and clear warnings only with a changed key', async () => {
  for (const input of [{ billing_mode: 'unknown' }, { markup_pct: -1 }, { markup_pct: 'NaN' }]) {
    const query = vi.fn().mockResolvedValue({ rows: [profile('superadmin')] })
    await expect(writeAiTenantSettings(query, { ...global, tenantId }, input, false)).rejects.toMatchObject({ status: 400 }); expect(query).toHaveBeenCalledTimes(1)
  }
  const query = vi.fn().mockResolvedValueOnce({ rows: [profile('superadmin')] }).mockResolvedValue({ rows: [] })
  await writeAiTenantSettings(query, { ...global, tenantId }, { openrouter_api_key: null, markup_pct: null }, false)
  expect(query.mock.calls[1][0]).toContain('last_key_error'); expect(query.mock.calls[1][1]).toContain(null)
})
it('usage aggregates preserve null-tenant buckets, exact bound scope and all-time unbilled facts without a source row cap', async () => {
  const query = vi.fn().mockResolvedValue({ rows: [{ tenant_id: null, calls: 2, cost_usd: '0.30000000', charge_usd: '0.39000000', unbilled: '0.13000000', tenant_calls: 1, platform_calls: 1 }] })
  const result = await readAiUsageSummary(query, '2026-11-01T00:00:00Z', tenantId)
  expect(result.get(null)).toEqual({ calls: 2, costUsd: 0.3, chargeUsd: 0.39, unbilledChargeUsd: 0.13, byKey: { tenant: 1, platform: 1 } })
  expect(query.mock.calls[0][1]).toEqual(['2026-11-01T00:00:00Z', tenantId]); expect(query.mock.calls[0][0]).toContain('sum(charge_usd)'); expect(query.mock.calls[0][0]).not.toContain('LIMIT 100000')
})
it('invalid numeric totals and stale profile authority refuse instead of producing a misleading payload', async () => {
  await expect(readAiUsageSummary(vi.fn().mockResolvedValue({ rows: [{ tenant_id: tenantId, calls: 1, cost_usd: 'NaN' }] }), '2026-11-01')).rejects.toMatchObject({ status: 503 })
  const query = vi.fn().mockResolvedValue({ rows: [{ ...profile('superadmin'), disabled_at: new Date() }] })
  await expect(writeAiPlatformSettings(query, global, { openrouter_api_key: encryptApiKey(randomUUID()) })).rejects.toMatchObject({ status: 403 }); expect(query).toHaveBeenCalledTimes(1)
})
