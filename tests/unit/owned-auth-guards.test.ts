import { randomBytes, randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ legacy: vi.fn(), service: vi.fn(), session: vi.fn(), logout: vi.fn(), query: vi.fn(),
  services: vi.fn(), context: vi.fn(), cookie: '', host: 'xprout.test', preview: '' }))
vi.mock('@/lib/supabase/server', () => ({ createClient: state.legacy, createServiceClient: state.service }))
vi.mock('@/lib/auth/identity-services', () => ({ getIdentityServices: state.services }))
vi.mock('@/lib/observability/context', () => ({ setRequestContext: state.context }))
vi.mock('@/lib/observability/with-api', () => ({ withApi: (_name: string, handler: unknown) => handler }))
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ host: state.host, cookie: state.cookie }),
  cookies: async () => ({ get: (name: string) => name === 'preview_tenant_id' && state.preview ? { value: state.preview } : undefined }),
}))
const user = randomUUID(), tenant = randomUUID(), preview = randomUUID(), token = randomBytes(32).toString('base64url')
const profile = (role = 'store-admin') => ({ id: user, role, tenant_id: tenant, full_name: 'Fixture', must_change_password: false,
  account_disabled_at: null, tenant: { id: tenant, name: 'Fixture', slug: 'fixture', is_active: true, plan: 'menu' } })

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); vi.stubEnv('OWNED_AUTH_ENABLED', 'true')
  state.cookie = `__Host-xm_identity=${token}`; state.host = 'xprout.test'; state.preview = ''
  state.session.mockResolvedValue({ userId: user, authenticatedAt: new Date(Date.now()-60_000) })
  state.logout.mockResolvedValue(undefined); state.query.mockResolvedValue({ rows: [profile()] })
  state.services.mockReturnValue({ config: { origin: 'https://xprout.test' },
    store: { session: state.session, logout: state.logout }, pool: { query: state.query } })
  state.legacy.mockImplementation(() => { throw new Error('Legacy must not run') })
  state.service.mockImplementation(() => { throw new Error('Service API must not run') })
})
afterEach(() => vi.unstubAllEnvs())

describe('owned core guards', () => {
  it('resolves a member tenant solely through verified native session/profile SQL', async () => {
    const { getEffectiveTenant } = await import('@/lib/get-effective-tenant')
    expect(await getEffectiveTenant()).toEqual({ tenantId: tenant, slug: 'fixture', name: 'Fixture', role: 'store-admin' })
    expect(state.context).toHaveBeenCalledWith({ actorId: user, tenantId: tenant, tenantSlug: 'fixture', role: 'store-admin' })
    expect(state.legacy).not.toHaveBeenCalled(); expect(state.service).not.toHaveBeenCalled()
  })

  it('ignores forged preview cookies for members, denies customers, and binds superadmin previews', async () => {
    state.preview = preview
    const { getEffectiveTenant } = await import('@/lib/get-effective-tenant')
    expect((await getEffectiveTenant())?.tenantId).toBe(tenant)
    state.query.mockResolvedValue({ rows: [profile('customer')] })
    expect(await getEffectiveTenant()).toBeNull()
    state.query.mockImplementation(async (text: string) => ({ rows: text.includes('FROM public.profiles') ? [profile('superadmin')]
      : [{ id: preview, name: 'Preview', slug: 'preview', is_active: true, plan: 'menu' }] }))
    expect((await getEffectiveTenant())?.tenantId).toBe(preview)
    expect(state.legacy).not.toHaveBeenCalled()
  })

  it('never promotes a matching configured email or returns a fake legacy client', async () => {
    vi.stubEnv('SUPERADMIN_EMAILS', 'owner@example.test')
    const { assertSuperadmin } = await import('@/lib/superadmin-auth')
    state.query.mockResolvedValue({ rows: [profile('customer')] })
    expect(await assertSuperadmin()).toBeNull()
    state.query.mockResolvedValue({ rows: [profile('superadmin')] })
    const guard = await assertSuperadmin()
    expect(guard?.mode).toBe('owned'); expect(guard?.principal.userId).toBe(user)
    expect(guard && 'legacyClient' in guard).toBe(false)
    expect(state.legacy).not.toHaveBeenCalled(); expect(state.service).not.toHaveBeenCalled()
  })

  it('fails closed on provider/SQL unavailability instead of trying legacy cookies', async () => {
    state.session.mockRejectedValue(new Error('private provider detail'))
    const { getEffectiveTenant } = await import('@/lib/get-effective-tenant')
    await expect(getEffectiveTenant()).rejects.toThrow('Authentication is temporarily unavailable')
    const { checkPasswordChangeRequired } = await import('@/lib/auth/password-guard')
    expect((await checkPasswordChangeRequired())?.status).toBe(503)
    expect(state.legacy).not.toHaveBeenCalled(); expect(state.service).not.toHaveBeenCalled()
  })

  it('denies missing/duplicated cookie and wrong canonical host without profile/legacy lookup', async () => {
    const { getEffectiveTenant } = await import('@/lib/get-effective-tenant')
    state.cookie = ''; expect(await getEffectiveTenant()).toBeNull()
    state.cookie = `__Host-xm_identity=${token};__Host-xm_identity=${token}`; expect(await getEffectiveTenant()).toBeNull()
    state.cookie = `__Host-xm_identity=${token}`; state.host = 'other.test'; expect(await getEffectiveTenant()).toBeNull()
    expect(state.query).not.toHaveBeenCalled(); expect(state.session).not.toHaveBeenCalled(); expect(state.legacy).not.toHaveBeenCalled()
  })

  it('preserves mandatory recovery and does not grant administrative access', async () => {
    state.query.mockResolvedValue({ rows: [{ ...profile('superadmin'), must_change_password: true }] })
    const { assertSuperadmin } = await import('@/lib/superadmin-auth')
    const { getEffectiveTenant } = await import('@/lib/get-effective-tenant')
    const { checkPasswordChangeRequired } = await import('@/lib/auth/password-guard')
    expect(await assertSuperadmin()).toBeNull(); expect(await getEffectiveTenant()).toBeNull()
    expect((await checkPasswordChangeRequired())?.status).toBe(403)
  })

  it('redirects from canonical stored role and refuses external/backslash destinations', async () => {
    state.query.mockResolvedValue({ rows: [profile('customer')] })
    const { POST } = await import('@/app/api/auth/resolve-redirect/route')
    for (const next of ['//outside.test', '/\\outside.test', '/\nunsafe']) {
      const result = await POST(new Request('https://xprout.test/api/auth/resolve-redirect', { method: 'POST', body: JSON.stringify({ next }) }))
      expect(await result.json()).toEqual({ redirectTo: '/' })
    }
    state.query.mockResolvedValue({ rows: [profile('superadmin')] })
    const result = await POST(new Request('https://xprout.test/api/auth/resolve-redirect', { method: 'POST', body: '{}' }))
    expect(await result.json()).toEqual({ redirectTo: '/overview' })
    expect(state.service).not.toHaveBeenCalled(); expect(state.legacy).not.toHaveBeenCalled()
  })

  it('returns to a safe customer surface without granting privileges or bypassing recovery',async()=>{
    state.query.mockResolvedValue({rows:[profile('superadmin')]})
    const {POST}=await import('@/app/api/auth/resolve-redirect/route')
    const request=(next:string)=>new Request('https://xprout.test/api/auth/resolve-redirect',{method:'POST',body:JSON.stringify({next,purpose:'customer'})})
    expect(await (await POST(request('/fixture/me'))).json()).toEqual({redirectTo:'/fixture/me'})
    expect(await (await POST(request('//outside.test'))).json()).toEqual({redirectTo:'/'})
    state.query.mockResolvedValue({rows:[{...profile('superadmin'),must_change_password:true}]})
    expect(await (await POST(request('/fixture/me'))).json()).toEqual({redirectTo:'/identity?recovery=required'})
  })

  it('logs out only the native session, clears its cookies and rejects cross-origin POSTs', async () => {
    const { POST } = await import('@/app/api/auth/signout/route')
    const request = (origin: string) => new Request('https://xprout.test/api/auth/signout', { method: 'POST',
      headers: { host: 'xprout.test', origin, cookie: `__Host-xm_identity=${token}` } })
    expect((await POST(request('https://other.test'))).status).toBe(403)
    expect(state.logout).not.toHaveBeenCalled()
    const response = await POST(request('https://xprout.test'))
    expect(response.status).toBe(303); expect(state.logout).toHaveBeenCalledWith(token)
    expect(response.headers.get('set-cookie')).toContain('__Host-xm_identity=')
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(state.legacy).not.toHaveBeenCalled()
  })

  it('selects an owned menu only inside the verified tenant and rejects forged origins', async () => {
    const menu = randomUUID()
    state.query.mockImplementation(async (sql: string) => sql.startsWith('SELECT id FROM public.menus') ? { rows: [{ id: menu }] } : { rows: [profile()] })
    const { POST } = await import('@/app/api/admin/menus/select/route')
    const request = (origin: string, id: string = menu) => new Request('https://xprout.test/api/admin/menus/select', { method: 'POST', headers: { origin }, body: JSON.stringify({ menu_id: id }) })
    expect((await POST(request('https://other.test'), undefined)).status).toBe(403)
    expect((await POST(request('https://xprout.test', 'invalid'), undefined)).status).toBe(400)
    const result = await POST(request('https://xprout.test'), undefined)
    expect(result.status).toBe(200)
    expect(state.query).toHaveBeenLastCalledWith('SELECT id FROM public.menus WHERE id=$1 AND tenant_id=$2', [menu, tenant])
    expect(result.headers.get('set-cookie')).toContain(`selected_menu_id=${menu}`)
    state.query.mockImplementation(async (sql: string) => sql.startsWith('SELECT id FROM public.menus') ? { rows: [] } : { rows: [profile()] })
    expect((await POST(request('https://xprout.test'), undefined)).status).toBe(404)
    expect(state.legacy).not.toHaveBeenCalled()
  })

  it('keeps the legacy branch off-switch functional without email auto-promotion', async () => {
    vi.stubEnv('OWNED_AUTH_ENABLED', 'false'); vi.stubEnv('SUPERADMIN_EMAILS', 'owner@example.test')
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: { role: 'customer' } }) }
    state.legacy.mockResolvedValue({ auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: user, email: 'owner@example.test' } } }) }, from: vi.fn().mockReturnValue(query) })
    const { isSuperadminRequest } = await import('@/lib/superadmin-auth')
    expect(await isSuperadminRequest()).toBe(false)
    expect(state.session).not.toHaveBeenCalled(); expect(state.service).not.toHaveBeenCalled()
  })
})
