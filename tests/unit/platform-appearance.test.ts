import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { postgresRuntimeConfig } from '@/lib/data/database-config'
import { readPlatformAppearance, selectPlatformAppearance } from '@/lib/data/platform-appearance'

const appearance = { cta_color: '#F52323', favicon_url: 'https://media.example.test/favicon.webp' }
function production() {
  const url = new URL('postgresql://appearance_reader@xmartmenu-db:5432/xmartmenu')
  url.password = randomUUID()
  return { NODE_ENV: 'production', PROD_DATABASE_HOST: 'xmartmenu-db', PROD_DATABASE_NAME: 'xmartmenu', PLATFORM_APPEARANCE_DATABASE_URL: url.href }
}

describe('public platform appearance boundary', () => {
  it('keeps the legacy reader by default without constructing an owned connection', async () => {
    const readers = { owned: vi.fn(), legacy: vi.fn(async () => appearance) }
    expect(await selectPlatformAppearance({}, readers)).toEqual(appearance)
    expect(readers.owned).not.toHaveBeenCalled()
  })
  it('uses only owned SQL when enabled; neither an error nor missing data falls back', async () => {
    const readers = { owned: vi.fn(async () => { throw new Error('private transport details') }), legacy: vi.fn() }
    await expect(selectPlatformAppearance({ OWNED_PLATFORM_APPEARANCE_ENABLED: 'true' }, readers)).rejects.toThrow()
    expect(readers.legacy).not.toHaveBeenCalled()
    expect(await selectPlatformAppearance({ OWNED_PLATFORM_APPEARANCE_ENABLED: 'true' }, { ...readers, owned: async () => null })).toBeNull()
    expect(readers.legacy).not.toHaveBeenCalled()
  })
  it('projects only the public color/icon fields, without serializing other stored settings', async () => {
    const query = vi.fn(async () => ({ rows: [{ ...appearance, id: randomUUID(), landing: { secret: 'internal' } }] }))
    expect(await readPlatformAppearance(query)).toEqual(appearance)
    expect(query.mock.calls).toHaveLength(1)
  })
  it('returns no appearance for an empty restore rather than creating or importing a row', async () => {
    expect(await readPlatformAppearance(async () => ({ rows: [] }))).toBeNull()
  })
  it.each([
    [appearance, appearance], [null], [{ cta_color: 3, favicon_url: null }],
    [{ cta_color: '#fff', favicon_url: 'x'.repeat(4097) }], [{ cta_color: '#fff' }],
  ].map(rows => ({ rows })))('fails closed on an invalid or non-singleton restored result %#', async ({ rows }) => {
    await expect(readPlatformAppearance(async () => ({ rows }))).rejects.toThrow('Platform appearance is unavailable')
  })
  it('sanitizes database errors without disclosing credentials, statements or hosts', async () => {
    await expect(readPlatformAppearance(async () => { throw new Error('postgresql://private@internal-host') }))
      .rejects.toThrow(/^Platform appearance is unavailable$/)
  })
  it('requires an independent explicit SQL target and no Google/ADC configuration', () => {
    const env = production()
    const config = postgresRuntimeConfig(env, 'PLATFORM_APPEARANCE')
    const client = new pg.Client(config)
    const parameters = (client as unknown as { connectionParameters: { host: string; database: string; user: string; ssl: unknown } }).connectionParameters
    expect(parameters).toMatchObject({ host: 'xmartmenu-db', database: 'xmartmenu', user: 'appearance_reader', ssl: { rejectUnauthorized: true } })
    expect(() => postgresRuntimeConfig({ ...env, PLATFORM_APPEARANCE_DATABASE_URL: undefined, DATABASE_URL: env.PLATFORM_APPEARANCE_DATABASE_URL }, 'PLATFORM_APPEARANCE')).toThrow()
    expect(() => postgresRuntimeConfig({ ...env, PROD_DATABASE_HOST: 'source.supabase.co', PLATFORM_APPEARANCE_DATABASE_URL: 'postgresql://reader@source.supabase.co/xmartmenu' }, 'PLATFORM_APPEARANCE')).toThrow()
    for (const option of ['host', 'user', 'port', 'options', 'sslcert']) {
      expect(() => postgresRuntimeConfig({ ...env, PLATFORM_APPEARANCE_DATABASE_URL: env.PLATFORM_APPEARANCE_DATABASE_URL + `?${option}=other` }, 'PLATFORM_APPEARANCE')).toThrow()
    }
  })
  it('never inherits production SQL/Google/storage settings while developing', () => {
    expect(() => postgresRuntimeConfig({ ...production(), NODE_ENV: 'development', DATABASE_URL: production().PLATFORM_APPEARANCE_DATABASE_URL }, 'PLATFORM_APPEARANCE')).toThrow()
    const ref = 'abcdefghijklmnopqrst'
    const config = postgresRuntimeConfig({ NODE_ENV: 'development', DEV_SUPABASE_PROJECT_REF: ref,
      DEV_SUPABASE_URL: `https://${ref}.supabase.co`, DEV_DATABASE_URL: `postgresql://postgres@db.${ref}.supabase.co/postgres?sslmode=disable`,
      DEV_SUPABASE_ANON_KEY: 'sb_publishable_test', DEV_SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test',
    }, 'PLATFORM_APPEARANCE')
    expect(config.ssl).toEqual({ rejectUnauthorized: true })
    expect(new URL(config.connectionString).hostname).toBe(`db.${ref}.supabase.co`)
  })
})
