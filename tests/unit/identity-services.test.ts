import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ pool: vi.fn(), config: vi.fn(), lookup: vi.fn(), adc: vi.fn(), token: vi.fn() }))
vi.mock('pg', () => ({ Pool: class { constructor(options: unknown) { mocks.pool(options) }; on() {} } }))
vi.mock('@/lib/auth/identity-runtime-config', () => ({ identityRuntimeConfig: mocks.config }))
vi.mock('@/lib/auth/provider-account-status', () => ({ createGoogleAccountStatusReader: mocks.lookup }))
vi.mock('@/lib/auth/google-runtime-adc', () => ({ readGoogleRuntimeAdc: mocks.adc }))
vi.mock('@/lib/auth/google-x509-access-token', () => ({ getGoogleX509AccessToken: mocks.token }))
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); vi.stubEnv('GOOGLE_AUTH_ENABLED', 'true')
  mocks.config.mockReturnValue({ connectionString: 'fixture-only', ssl: false, origin: 'https://fixture.test', web: { projectId: 'fixture' }, projectNumber: '1' })
  mocks.lookup.mockReturnValue(vi.fn())
})
afterEach(() => vi.unstubAllEnvs())

it('shares one bounded IDENTITY pool for all native principal/pilot/shell readers', async () => {
  const { getIdentityServices } = await import('@/lib/auth/identity-services')
  expect(getIdentityServices()).toBe(getIdentityServices())
  expect(mocks.pool).toHaveBeenCalledTimes(1)
  expect(mocks.pool).toHaveBeenCalledWith(expect.objectContaining({ max: 2, connectionTimeoutMillis: 5000, statement_timeout: 5000, query_timeout: 6000 }))
  expect(mocks.adc).not.toHaveBeenCalled(); expect(mocks.token).not.toHaveBeenCalled()
})

it('does not construct a pool or reuse cached identity services while Google is disabled', async () => {
  const { getIdentityServices } = await import('@/lib/auth/identity-services')
  vi.stubEnv('GOOGLE_AUTH_ENABLED', 'false')
  expect(() => getIdentityServices()).toThrow('unavailable'); expect(mocks.pool).not.toHaveBeenCalled()
  vi.stubEnv('GOOGLE_AUTH_ENABLED', 'true'); getIdentityServices()
  vi.stubEnv('GOOGLE_AUTH_ENABLED', 'false'); expect(() => getIdentityServices()).toThrow('unavailable')
  expect(mocks.pool).toHaveBeenCalledTimes(1)
})
