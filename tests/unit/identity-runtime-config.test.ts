import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { describe, expect, it } from 'vitest'
import { identityLegacyProofConfig, identityRuntimeConfig } from '@/lib/auth/identity-runtime-config'

const ref = 'abcdefghijklmnopqrst'
function database(host: string, name = 'postgres') {
  const url = new URL(`postgresql://${host}:5432/${name}`)
  url.username = 'postgres'; url.password = randomUUID()
  return url.href
}
const base = () => ({ NODE_ENV: 'development', IDENTITY_ORIGIN: 'http://localhost:3000', GOOGLE_AUTH_PROJECT_ID: 'skaleclub', GOOGLE_AUTH_WEB_API_KEY: randomUUID(),
  DEV_GOOGLE_AUTH_PROJECT_ID: 'identity-development', DEV_GOOGLE_AUTH_PROJECT_NUMBER: '123456789012', DEV_GOOGLE_AUTH_WEB_API_KEY: randomUUID(),
  DEV_SUPABASE_PROJECT_REF: ref, DEV_SUPABASE_URL: `https://${ref}.supabase.co`, DEV_SUPABASE_ANON_KEY: randomUUID(), DEV_SUPABASE_SERVICE_ROLE_KEY: randomUUID(), DEV_DATABASE_URL: database(`db.${ref}.supabase.co`) })

describe('pilot runtime target isolation', () => {
  it('uses the explicit isolated dev project and mandatory TLS', () => {
    const env = base(); env.DEV_DATABASE_URL += '?sslmode=disable'
    const config = identityRuntimeConfig(env)
    expect(new URL(config.connectionString).hostname).toBe(`db.${ref}.supabase.co`)
    expect(new URL(config.connectionString).searchParams.has('sslmode')).toBe(false)
    expect(new URL(config.connectionString).searchParams.has('ssl')).toBe(false)
    expect(config.ssl).toEqual({ rejectUnauthorized: true })
  })
  it('never uses legacy SQL aliases or the production source in development', () => {
    expect(() => identityRuntimeConfig({ ...base(), DEV_DATABASE_URL: undefined, DATABASE_URL: database('source.example.test') })).toThrow()
    expect(() => identityRuntimeConfig({ ...base(), DEV_SUPABASE_PROJECT_REF: 'ktogbpqookfcqilqvici' })).toThrow()
  })
  it('pins legacy ownership verification to the isolated dev Auth project too', () => {
    const env = { ...base(), NEXT_PUBLIC_SUPABASE_URL: 'https://ktogbpqookfcqilqvici.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: randomUUID() }
    expect(identityLegacyProofConfig(env).url).toBe(`https://${ref}.supabase.co`)
    expect(identityLegacyProofConfig(env).anonKey).toBe(env.DEV_SUPABASE_ANON_KEY)
    expect(() => identityLegacyProofConfig({ NODE_ENV: 'development', NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: env.NEXT_PUBLIC_SUPABASE_ANON_KEY })).toThrow()
  })
  it('requires separate explicit Google dev fields and rejects production IDs, numbers or keys', () => {
    const env = base()
    expect(identityRuntimeConfig(env).web.projectId).toBe('identity-development')
    for (const overrides of [
      { DEV_GOOGLE_AUTH_PROJECT_ID: undefined }, { DEV_GOOGLE_AUTH_PROJECT_NUMBER: undefined }, { DEV_GOOGLE_AUTH_WEB_API_KEY: undefined },
      { DEV_GOOGLE_AUTH_PROJECT_ID: 'skaleclub' }, { DEV_GOOGLE_AUTH_PROJECT_NUMBER: '937861185231' },
      { GOOGLE_AUTH_PROJECT_ID: 'another-production', DEV_GOOGLE_AUTH_PROJECT_ID: 'another-production' },
      { GOOGLE_AUTH_PROJECT_NUMBER: '123456789012' }, { DEV_GOOGLE_AUTH_WEB_API_KEY: env.GOOGLE_AUTH_WEB_API_KEY },
    ]) expect(() => identityRuntimeConfig({ ...env, ...overrides })).toThrow()
  })
  it('lets development opt into the shared project explicitly, never production', () => {
    const shared = { ...base(), DEV_GOOGLE_AUTH_PROJECT_ID: 'skaleclub', DEV_GOOGLE_AUTH_PROJECT_NUMBER: '937861185231' }
    expect(() => identityRuntimeConfig(shared)).toThrow()
    expect(identityRuntimeConfig({ ...shared, DEV_GOOGLE_AUTH_SHARED_PROJECT: 'true' }).web.projectId).toBe('skaleclub')
    expect(() => identityRuntimeConfig({ ...shared, DEV_GOOGLE_AUTH_SHARED_PROJECT: 'yes' })).toThrow()
  })
  it('requires the exact independent production host/name and explicit runtime URL', () => {
    const env = { ...base(), NODE_ENV: 'production', IDENTITY_ORIGIN: 'https://identity.example.test', PROD_DATABASE_HOST: 'xmartmenu-db', PROD_DATABASE_NAME: 'xmartmenu', IDENTITY_DATABASE_URL: database('xmartmenu-db', 'xmartmenu') }
    expect(identityRuntimeConfig(env).ssl).toEqual({ rejectUnauthorized: true })
    expect(() => identityRuntimeConfig({ ...env, IDENTITY_DATABASE_URL: undefined, DATABASE_URL: env.IDENTITY_DATABASE_URL })).toThrow()
    expect(() => identityRuntimeConfig({ ...env, PROD_DATABASE_HOST: 'another-db' })).toThrow()
    expect(() => identityRuntimeConfig({ ...env, PROD_DATABASE_HOST: `db.${ref}.supabase.co`, IDENTITY_DATABASE_URL: database(`db.${ref}.supabase.co`, 'xmartmenu') })).toThrow()
    expect(identityRuntimeConfig({ ...env, IDENTITY_DATABASE_SSL: 'disable' }).ssl).toBe(false)
  })
  it('rejects emulators, non-local HTTP and malformed canonical origins', () => {
    expect(() => identityRuntimeConfig({ ...base(), FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099' })).toThrow()
    for (const IDENTITY_ORIGIN of ['http://identity.example.test', 'https://identity.example.test/path', 'https://identity.example.test/?next=other']) {
      expect(() => identityRuntimeConfig({ ...base(), IDENTITY_ORIGIN })).toThrow()
    }
  })
  it('rejects driver connection-query overrides before an identity pool can be constructed', () => {
    for (const key of ['host', 'user', 'port', 'password', 'database', 'connectionString', 'ssl', 'sslcert', 'options']) {
      const env = base(); const url = new URL(env.DEV_DATABASE_URL); url.searchParams.set(key, 'another-target')
      expect(() => identityRuntimeConfig({ ...env, DEV_DATABASE_URL: url.href })).toThrow()
      expect(() => identityRuntimeConfig({ ...env, NODE_ENV: 'production', IDENTITY_ORIGIN: 'https://identity.example.test', PROD_DATABASE_HOST: 'xmartmenu-db', PROD_DATABASE_NAME: 'xmartmenu', IDENTITY_DATABASE_URL: database('xmartmenu-db', 'xmartmenu') + `?${key}=another-target` })).toThrow()
    }
    const env = base(); const config = identityRuntimeConfig(env)
    const client = new pg.Client({ connectionString: config.connectionString, ssl: config.ssl })
    const parameters = (client as unknown as { connectionParameters: { host: string; user: string; port: number; database: string; ssl: unknown } }).connectionParameters
    expect(parameters).toMatchObject({ host: `db.${ref}.supabase.co`, user: 'postgres', port: 5432, database: 'postgres', ssl: { rejectUnauthorized: true } })
  })
})
