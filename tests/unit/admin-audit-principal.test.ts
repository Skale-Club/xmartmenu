import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const mocks = vi.hoisted(() => ({ principal: vi.fn(),source: vi.fn(),transaction: vi.fn(),query: vi.fn() }))
vi.mock('@/lib/auth/owned-principal-runtime',() => ({ getOwnedPrincipal: mocks.principal }))
vi.mock('@/lib/supabase/server',() => ({ createClient: mocks.source }))
vi.mock('@/lib/data/admin-menus-runtime',() => ({ ownedAdminTransaction: mocks.transaction }))

import { readOwnedPlatformAuditPage } from '@/lib/data/admin-audit-runtime'
import AuditPage from '@/app/(superadmin)/audit/page'

const principal = { userId: 'e7c86fe0-6491-4fa7-a6d8-55de55bb1427',role: 'superadmin',mustChangePassword: false }
beforeEach(() => {
  vi.stubEnv('OWNED_AUTH_ENABLED','true')
  vi.stubEnv('OWNED_ADMIN_MENUS_ENABLED','true')
  mocks.principal.mockResolvedValue(principal)
  mocks.query.mockResolvedValue({ rows: [] })
  mocks.transaction.mockImplementation(async (_write,operation) => operation(mocks.query))
})
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs() })

describe('platform audit current-principal boundary',() => {
  it.each(['missing','downgraded','disabled','recovery','provider-unavailable'])('blocks %s in page and public adapter before any audit transaction',async state => {
    if (state === 'downgraded') mocks.principal.mockResolvedValue({ ...principal,role: 'store-admin' })
    else if (state === 'recovery') mocks.principal.mockResolvedValue({ ...principal,mustChangePassword: true })
    else if (state === 'provider-unavailable') mocks.principal.mockRejectedValue(new Error('Provider unavailable'))
    // The principal service returns null for expired/revoked/disabled accounts.
    else mocks.principal.mockResolvedValue(null)
    const html = renderToStaticMarkup(await AuditPage({ searchParams: Promise.resolve({}) }))
    expect(html).toContain('Could not load the audit trail')
    await expect(readOwnedPlatformAuditPage({})).rejects.toThrow()
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.query).not.toHaveBeenCalled()
    expect(mocks.source).not.toHaveBeenCalled()
  })

  it('derives the role from a fresh principal on every adapter call',async () => {
    const result = await readOwnedPlatformAuditPage({ days: 7 })
    expect(result).toEqual({ rows: [],tenants: [],people: [] })
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
    expect(mocks.query).toHaveBeenCalledTimes(2)
    mocks.transaction.mockClear(); mocks.query.mockClear()
    mocks.principal.mockResolvedValue({ ...principal,role: 'store-admin' })
    await expect(readOwnedPlatformAuditPage({})).rejects.toMatchObject({ status: 403 })
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.query).not.toHaveBeenCalled()
    expect(mocks.source).not.toHaveBeenCalled()
  })

  it('independently verifies legacy ownership when only the SQL source flag is selected',async () => {
    vi.stubEnv('OWNED_AUTH_ENABLED','false')
    const single = vi.fn().mockResolvedValue({ data: { role: 'superadmin',must_change_password: false },error: null })
    const eq = vi.fn(() => ({ single })), select = vi.fn(() => ({ eq })), from = vi.fn(() => ({ select }))
    const getUser = vi.fn().mockResolvedValue({ data: { user: { id: principal.userId } },error: null })
    mocks.source.mockResolvedValue({ auth: { getUser },from })
    await readOwnedPlatformAuditPage({})
    expect(getUser).toHaveBeenCalledOnce()
    expect(eq).toHaveBeenCalledWith('id',principal.userId)
    expect(mocks.principal).not.toHaveBeenCalled()
    mocks.transaction.mockClear(); mocks.query.mockClear()
    single.mockResolvedValue({ data: { role: 'store-admin',must_change_password: false },error: null })
    await expect(readOwnedPlatformAuditPage({})).rejects.toMatchObject({ status: 403 })
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.query).not.toHaveBeenCalled()
  })
})
