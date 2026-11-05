import { describe, expect, it } from 'vitest'
import { enrichGoogleUsers, planClaims } from '../../scripts/ops/import-google-subject-claims'

const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222'
const google = (sub: string) => [{ provider: 'google', provider_id: sub, identity_data: { sub } }]

describe('importer plan', () => {
  it('claims only exact app UIDs and ignores e-mail entirely', () => {
    const plan = planClaims([
      { id: a, email: 'same@example.test', identities: google('100000000000000001') },
      { id: b, email: 'same@example.test', identities: google('100000000000000002') },
      { id: '33333333-3333-4333-8333-333333333333', identities: [{ provider: 'email' }] },
    ] as never, new Set([a]))
    expect(plan.claims).toEqual([{ googleSub: '100000000000000001', accountId: a }])
    expect(plan).toMatchObject({ skippedNoAccount: 1, skippedNoGoogle: 1 })
  })
  it('rejects non-numeric or ambiguous subjects and deduplicates', () => {
    const plan = planClaims([
      { id: a, identities: google('not-a-sub') },
      { id: a, identities: [...google('100000000000000001'), ...google('100000000000000009')] },
      { id: a, identities: google('100000000000000001') },
      { id: a, identities: google('100000000000000001') },
    ] as never, new Set([a]))
    expect(plan.claims).toHaveLength(1)
    expect(plan.skippedNoGoogle).toBe(2)
  })
})

describe('real Admin API shape (listing has no identities, detail does)', () => {
  const listing = [
    { id: a, identities: [], app_metadata: { providers: ['email', 'google'] } },
    { id: b, identities: [], app_metadata: { providers: ['email'] } },
  ]
  const detail = async (id: string) => ({ id, identities: google('100000000000000001') })
  it('finds the Google account through the per-user detail', async () => {
    const calls: string[] = []
    const users = await enrichGoogleUsers(listing, async id => { calls.push(id); return detail(id) })
    expect(calls).toEqual([a])
    expect(planClaims(users, new Set([a, b])).claims).toEqual([{ googleSub: '100000000000000001', accountId: a }])
    // Old behaviour: the bare listing yields nothing.
    expect(planClaims(listing, new Set([a, b])).claims).toEqual([])
  })
  it('caps the detail fetches and checks the id', async () => {
    await expect(enrichGoogleUsers(listing, detail, 0)).rejects.toThrow()
    await expect(enrichGoogleUsers(listing, async () => ({ id: b, identities: [] }))).rejects.toThrow()
  })
})
