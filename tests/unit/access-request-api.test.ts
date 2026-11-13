import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class Denied extends Error {}
  return {
    Denied,
    owned: vi.fn(), context: vi.fn(), tx: vi.fn(), notify: vi.fn(), notifyAbandoned: vi.fn(), rate: vi.fn(),
    read: vi.fn(), save: vi.fn(), submit: vi.fn(), abandoned: vi.fn(), mark: vi.fn(), getUser: vi.fn(),
  }
})

vi.mock('@/lib/auth/owned-principal', () => ({ ownedAuthSelected: mocks.owned, ownedSessionToken: vi.fn() }))
vi.mock('@/lib/auth/native-onboarding', () => ({ NativeOnboardingDenied: mocks.Denied, nativeOnboarding: vi.fn() }))
vi.mock('@/lib/access-requests/applicant-context', () => ({ ownedApplicantContext: mocks.context }))
vi.mock('@/lib/data/admin-menus-runtime', () => ({ ownedAdminTransaction: mocks.tx }))
vi.mock('@/lib/access-requests/notify', () => ({ notifyAccessRequestSubmitted: mocks.notify, notifyAbandonedDraft: mocks.notifyAbandoned }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: mocks.rate }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
  createServiceClient: vi.fn(),
}))
vi.mock('@/lib/xphere/queue', () => ({ enqueueXphereSync: vi.fn() }))
vi.mock('@/lib/tenant-effects/publish-pending', () => ({ publishPendingNativeTenantEffects: vi.fn() }))
vi.mock('@/lib/access-requests/store', async () => {
  const actual = await vi.importActual<typeof import('@/lib/access-requests/store')>('@/lib/access-requests/store')
  return { ...actual, readApplicantState: mocks.read, saveAccessRequestDraft: mocks.save, submitAccessRequest: mocks.submit, abandonedDrafts: mocks.abandoned, markAbandonedNotified: mocks.mark }
})

import { AccessRequestError } from '@/lib/access-requests/store'
import { POST as onboardingPost } from '@/app/api/onboarding/route'
import { GET, PUT, POST } from '@/app/api/access-request/route'
import { POST as cronPost } from '@/app/api/internal/access-requests/abandoned/route'

const ctx = { userId: 'u1', sessionHash: 'h'.repeat(64) }
const req = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request('https://app.test/api/x', { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  mocks.owned.mockReturnValue(true)
  mocks.context.mockResolvedValue(ctx)
  mocks.rate.mockResolvedValue({ ok: true })
  mocks.tx.mockImplementation(async (_write: boolean, run: (q: unknown) => unknown) => run(vi.fn()))
  mocks.getUser.mockResolvedValue({ data: { user: null } })
})

describe('self-service onboarding lock', () => {
  for (const owned of [true, false]) {
    it(`POST /api/onboarding is 403 when the switch is off (owned=${owned})`, async () => {
      mocks.owned.mockReturnValue(owned)
      const res = await onboardingPost(req('POST', {}))
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'Self-service onboarding is disabled.' })
      expect(mocks.context).not.toHaveBeenCalled()
      expect(mocks.getUser).not.toHaveBeenCalled()
    })
  }
  it('is unchanged when the switch is on', async () => {
    vi.stubEnv('SELF_SERVICE_ONBOARDING_ENABLED', 'true')
    mocks.owned.mockReturnValue(false)
    expect((await onboardingPost(req('POST', {}))).status).toBe(401)
    mocks.owned.mockReturnValue(true)
    mocks.context.mockRejectedValue(new mocks.Denied('x'))
    expect((await onboardingPost(req('POST', {}))).status).toBe(403)
    expect(mocks.context).toHaveBeenCalled()
  })
})

describe('/api/access-request', () => {
  it('is 404 when owned auth is off', async () => {
    mocks.owned.mockReturnValue(false)
    for (const call of [() => GET(req('GET')), () => PUT(req('PUT', {})), () => POST(req('POST', {}))]) expect((await call()).status).toBe(404)
    expect(mocks.context).not.toHaveBeenCalled()
  })
  it('GET returns the applicant state with no-store', async () => {
    mocks.read.mockResolvedValue({ status: 'none' })
    const res = await GET(req('GET'))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ status: 'none' })
  })
  it('PUT saves, limits and rejects oversized or malformed bodies', async () => {
    mocks.save.mockResolvedValue({ ok: true })
    expect((await PUT(req('PUT', { step: 'language', answers: {} }))).status).toBe(200)
    expect(mocks.save).toHaveBeenCalledWith(expect.anything(), ctx, { step: 'language', answers: {} })
    expect((await PUT(req('PUT', 'x'.repeat(12001)))).status).toBe(400)
    expect((await PUT(req('PUT', '{'))).status).toBe(400)
    mocks.rate.mockResolvedValue({ ok: false })
    expect((await PUT(req('PUT', {}))).status).toBe(429)
  })
  it('submit notifies only when a lead is returned', async () => {
    const lead = { requestId: 'r', name: 'Ana', accountPhone: null, answers: {} }
    mocks.submit.mockResolvedValueOnce({ status: 'pending', requestId: 'r', lead })
    const res = await POST(req('POST', {}))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'pending' })
    expect(mocks.notify).toHaveBeenCalledWith(lead)
    mocks.notify.mockClear()
    mocks.submit.mockResolvedValueOnce({ status: 'pending', requestId: 'r', lead: null })
    expect((await POST(req('POST', {}))).status).toBe(200)
    expect(mocks.notify).not.toHaveBeenCalled()
  })
  it('submit still answers 200 when the notifier throws or rejects', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.submit.mockResolvedValue({ status: 'pending', requestId: 'r', lead: { requestId: 'r', name: null, accountPhone: null, answers: {} } })
    mocks.notify.mockImplementationOnce(() => { throw new Error('boom') })
    expect((await POST(req('POST', {}))).status).toBe(200)
    mocks.notify.mockRejectedValueOnce(new Error('boom'))
    expect((await POST(req('POST', {}))).status).toBe(200)
  })
  it('maps errors without leaking SQL', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.submit.mockRejectedValueOnce(new AccessRequestError(409, 'This request was already sent'))
    let res = await POST(req('POST', {}))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'This request was already sent' })
    mocks.context.mockRejectedValueOnce(new mocks.Denied('x'))
    expect((await GET(req('GET'))).status).toBe(403)
    mocks.read.mockRejectedValueOnce(Object.assign(new Error('relation "access_requests" does not exist'), { code: '42P01' }))
    res = await GET(req('GET'))
    expect(res.status).toBe(503)
    expect(JSON.stringify(await res.json())).not.toContain('relation')
    mocks.read.mockRejectedValueOnce(new Error('select * from secret'))
    res = await GET(req('GET'))
    expect(res.status).toBe(503)
    expect(JSON.stringify(await res.json())).not.toContain('select')
  })
})

describe('abandoned-draft cron', () => {
  const call = (auth?: string) => cronPost(req('POST', undefined, auth ? { authorization: auth } : {}))
  it('is 503 without a secret and 401 with a missing or wrong one', async () => {
    expect((await call('Bearer s3cret')).status).toBe(503)
    vi.stubEnv('CRON_SECRET', 's3cret')
    expect((await call()).status).toBe(401)
    expect((await call('Bearer nope')).status).toBe(401)
    expect(mocks.abandoned).not.toHaveBeenCalled()
  })
  it('notifies and marks only the drafts that were delivered', async () => {
    vi.stubEnv('CRON_SECRET', 's3cret')
    mocks.abandoned.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
    mocks.notifyAbandoned.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const res = await call('Bearer s3cret')
    expect(await res.json()).toEqual({ checked: 2, notified: 1 })
    expect(mocks.mark).toHaveBeenCalledTimes(1)
    expect(mocks.mark).toHaveBeenCalledWith(expect.anything(), 'a')
  })
  it('reports an unavailable table', async () => {
    vi.stubEnv('CRON_SECRET', 's3cret')
    mocks.abandoned.mockRejectedValue(Object.assign(new Error('x'), { code: '42P01' }))
    expect(await (await call('Bearer s3cret')).json()).toEqual({ checked: 0, notified: 0, unavailable: true })
  })
})
