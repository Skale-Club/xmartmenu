import { describe, expect, it } from 'vitest'
import pg from 'pg'
import { developmentConfig, migrationTarget, SOURCE_SUPABASE_PROJECT } from '../../scripts/lib/database-target.mjs'

const ref = 'abcdefghijklmnopqrst'
const dev = () => ({ DEV_SUPABASE_PROJECT_REF: ref, DEV_SUPABASE_URL: `https://${ref}.supabase.co`,
  DEV_DATABASE_URL: `postgresql://postgres.${ref}:example@aws-1-us-east-1.pooler.supabase.com:5432/postgres`,
  DEV_SUPABASE_ANON_KEY: 'sb_publishable_test', DEV_SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test' })

describe('explicit database targets', () => {
  it('never inherits source or production aliases', () => {
    expect(() => migrationTarget({ DATABASE_URL: 'postgresql://prod:example@prod/app' })).toThrow()
    expect(migrationTarget({ ...dev(), DATABASE_URL: 'postgresql://prod:example@prod/app' })).toContain(ref)
  })
  it('rejects the source production project as development', () => {
    expect(() => developmentConfig({ ...dev(), DEV_SUPABASE_PROJECT_REF: SOURCE_SUPABASE_PROJECT })).toThrow()
  })
  it.each([
    { DEV_SUPABASE_URL: 'https://other.supabase.co' },
    { DEV_DATABASE_URL: 'postgresql://postgres.other:example@aws-1-us-east-1.pooler.supabase.com:5432/postgres' },
    { DEV_DATABASE_URL: 'postgresql://postgres:example@localhost:5432/postgres' },
    { DEV_SUPABASE_SERVICE_ROLE_KEY: '' },
    { DEV_SUPABASE_ANON_KEY: 'eyJ.' + Buffer.from(JSON.stringify({ ref: SOURCE_SUPABASE_PROJECT })).toString('base64url') + '.sig' },
  ])('rejects mismatched development configuration %j', override => {
    expect(() => developmentConfig({ ...dev(), ...override })).toThrow()
  })
  it('requires an explicit independent production target', () => {
    const env = { PROD_MIGRATION_DATABASE_URL: 'postgresql://migrator:example@xmartmenu-db:5432/xmartmenu', PROD_DATABASE_HOST: 'xmartmenu-db', PROD_DATABASE_NAME: 'xmartmenu' }
    expect(migrationTarget(env, 'production')).toContain('xmartmenu-db')
    expect(() => migrationTarget({ ...env, PROD_DATABASE_HOST: 'other' }, 'production')).toThrow()
    expect(() => migrationTarget({ ...env, PROD_DATABASE_HOST: 'db.foo.supabase.co', PROD_MIGRATION_DATABASE_URL: 'postgresql://a:b@db.foo.supabase.co/postgres', PROD_DATABASE_NAME: 'postgres' }, 'production')).toThrow()
  })
  it('permits transaction pooling for the app but refuses it for migrations', () => {
    const config = { ...dev(), DEV_DATABASE_URL: dev().DEV_DATABASE_URL.replace(':5432/', ':6543/') }
    expect(developmentConfig(config).databaseUrl).toContain(':6543/')
    expect(() => migrationTarget(config)).toThrow('session pooler')
    expect(migrationTarget({ ...config, DEV_MIGRATION_DATABASE_URL: dev().DEV_DATABASE_URL })).toContain(':5432/')
  })
  it('rejects node-postgres query precedence over the validated host/user/port', () => {
    for (const key of ['host', 'user', 'port', 'password', 'database', 'connectionString', 'ssl', 'sslcert', 'sslkey', 'sslrootcert', 'options', 'service']) {
      const source = new URL(dev().DEV_DATABASE_URL)
      source.searchParams.set(key, 'another-target')
      expect(() => developmentConfig({ ...dev(), DEV_DATABASE_URL: source.href })).toThrow()
      expect(() => migrationTarget({ PROD_DATABASE_HOST: 'xmartmenu-db', PROD_DATABASE_NAME: 'xmartmenu', PROD_MIGRATION_DATABASE_URL: `postgresql://migrator@xmartmenu-db:5432/xmartmenu?${key}=another-target` }, 'production')).toThrow()
    }
    expect(() => developmentConfig({ ...dev(), DEV_DATABASE_URL: dev().DEV_DATABASE_URL + '?%68ost=another-target' })).toThrow()
    expect(() => developmentConfig({ ...dev(), DEV_DATABASE_URL: dev().DEV_DATABASE_URL + '?sslmode=require&sslmode=disable' })).toThrow()
    const config = developmentConfig({ ...dev(), DEV_DATABASE_URL: dev().DEV_DATABASE_URL + '?application_name=identity-test&sslmode=disable' })
    const client = new pg.Client({ connectionString: config.databaseUrl })
    const parameters = (client as unknown as { connectionParameters: { host: string; user: string; port: number; database: string; ssl: unknown } }).connectionParameters
    expect(parameters).toMatchObject({ host: 'aws-1-us-east-1.pooler.supabase.com', user: `postgres.${ref}`, port: 5432, database: 'postgres' })
    expect(parameters.ssl).not.toBe(false)
  })
})
