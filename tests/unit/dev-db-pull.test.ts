import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { PRODUCTION_PROJECT_REFS, SOURCE_SUPABASE_PROJECT } from '../../scripts/lib/database-target.mjs'
import {
  EXCLUDED_TABLES, SCRUBBED_COLUMNS, SOURCE_CANDIDATE_NOTICE, SOURCE_IS_CANDIDATE,
  assertPullDestination, compareSchemas, DEV_PULL_BACKUP_DIRECTORY, foreignKeyOrder, isExcludedTable, isScrubbedColumn, productionPullSource, truncationSet,
} from '../../scripts/lib/dev-db-pull'

const ref = 'abcdefghijklmnopqrst'
// Offline-only credentials are generated rather than committed as scanner findings.
const secret = randomUUID()
const good = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: 'development',
  DEV_SUPABASE_PROJECT_REF: ref,
  DEV_DATABASE_URL: `postgresql://postgres.${ref}:${secret}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`,
  ...extra,
})

describe('Xprout pull configuration compatibility', () => {
  it('prefers current aliases independently while retaining legacy machine settings', () => {
    expect(productionPullSource({ XPROUT_PROD_SSH: 'new-host', XMARTMENU_PROD_SSH: 'old-host',
      XPROUT_PROD_DB_CONTAINER: 'newcontainer', XMARTMENU_PROD_DB_CONTAINER: 'oldcontainer',
      XPROUT_PROD_DB_NAME: 'selected_db', XMARTMENU_PROD_DB_NAME: 'legacy_db' }))
      .toEqual({ sshTarget: 'new-host', container: 'newcontainer', database: 'selected_db' })
    expect(productionPullSource({ XMARTMENU_PROD_SSH: 'old-host', XMARTMENU_PROD_DB_CONTAINER: 'oldcontainer', XMARTMENU_PROD_DB_NAME: 'legacy_db' }))
      .toEqual({ sshTarget: 'old-host', container: 'oldcontainer', database: 'legacy_db' })
    expect(productionPullSource({ XPROUT_PROD_SSH: '', XMARTMENU_PROD_SSH: 'old-host' }).sshTarget).toBe('old-host')
  })

  it('renames backup storage without renaming the physical source database or enabling a source', () => {
    expect(DEV_PULL_BACKUP_DIRECTORY).toBe('xprout-db-backups')
    expect(productionPullSource({})).toEqual({ sshTarget: undefined, container: 'e12scyfsrp822dag7m9wwd4x', database: 'xmartmenu' })
  })
})

describe('db:pull destination (pure)', () => {
  it('accepts only the declared Supabase development project', () => {
    expect(assertPullDestination(good()).projectRef).toBe(ref)
  })

  it('refuses a destination that resolves to production', () => {
    for (const productionRef of PRODUCTION_PROJECT_REFS) {
      expect(() => assertPullDestination(good({
        DEV_SUPABASE_PROJECT_REF: productionRef,
        DEV_DATABASE_URL: `postgresql://postgres.${productionRef}:${secret}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`,
      }))).toThrow()
    }
    // Owner decision 2026-11-07: no Supabase project serves customers; production is the owned PostgreSQL.
    expect(PRODUCTION_PROJECT_REFS).not.toContain(SOURCE_SUPABASE_PROJECT)
  })

  it('accepts the retired source project as the development destination', () => {
    expect(assertPullDestination(good({
      DEV_SUPABASE_PROJECT_REF: SOURCE_SUPABASE_PROJECT,
      DEV_DATABASE_URL: `postgresql://postgres.${SOURCE_SUPABASE_PROJECT}:${secret}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`,
    })).projectRef).toBe(SOURCE_SUPABASE_PROJECT)
  })

  it('refuses a production URL smuggled under a development ref, other hosts, aliases and NODE_ENV=production', () => {
    expect(() => assertPullDestination(good({
      DEV_DATABASE_URL: `postgresql://postgres.${SOURCE_SUPABASE_PROJECT}:${secret}@aws-1-us-east-1.pooler.supabase.com:5432/postgres`,
    }))).toThrow()
    expect(() => assertPullDestination(good({ DEV_DATABASE_URL: `postgres://u:${secret}@127.0.0.1:5432/postgres` }))).toThrow()
    expect(() => assertPullDestination(good({ DEV_DATABASE_URL: `postgres://u:${secret}@10.0.0.2:5432/xmartmenu` }))).toThrow()
    expect(() => assertPullDestination(good({ NODE_ENV: 'production' }))).toThrow(/production/)
    // Only the production aliases: never a fallback.
    expect(() => assertPullDestination({ NODE_ENV: 'development', DATABASE_URL: `postgres://u:${secret}@db:5432/x`, PROD_MIGRATION_DATABASE_URL: `postgres://u:${secret}@db:5432/x` })).toThrow()
  })
})

describe('db:pull table, secret and source rules (pure)', () => {
  it('keeps sign-in state local and copies business tables', () => {
    expect([...EXCLUDED_TABLES].sort()).toEqual(['app_identity_challenges', 'app_sessions', 'oauth_codes'])
    for (const table of EXCLUDED_TABLES) expect(isExcludedTable(table)).toBe(true)
    for (const table of ['tenants', 'profiles', 'products', 'orders', 'order_items', 'menus']) expect(isExcludedTable(table)).toBe(false)
  })

  it('never copies Telegram or AI provider secrets', () => {
    expect(SCRUBBED_COLUMNS).toEqual({
      telegram_settings: ['bot_token', 'approvals_bot_token', 'webhook_secret'],
      platform_ai_settings: ['openrouter_api_key'],
      tenant_ai_settings: ['openrouter_api_key'],
      chat_addon_settings: ['openrouter_api_key', 'audio_api_key'],
      blog_settings: ['openrouter_api_key'],
    })
    expect(isScrubbedColumn('telegram_settings', 'bot_token')).toBe(true)
    expect(isScrubbedColumn('orders', 'total')).toBe(false)
  })

  it('declares that the source is the imported candidate until the cutover', () => {
    expect(SOURCE_IS_CANDIDATE).toBe(true)
    expect(SOURCE_CANDIDATE_NOTICE).toMatch(/2026-11-04/)
    expect(SOURCE_CANDIDATE_NOTICE).toMatch(/stale/i)
  })

  it('orders foreign keys parents first and rejects cycles', () => {
    const keys = [{ child: 'b', parent: 'a' }, { child: 'c', parent: 'b' }, { child: 'c', parent: 'c' }]
    expect(foreignKeyOrder(['c', 'b', 'a'], keys)).toEqual(['a', 'b', 'c'])
    expect(() => foreignKeyOrder(['a', 'b'], [{ child: 'a', parent: 'b' }, { child: 'b', parent: 'a' }])).toThrow(/cycle/)
  })

  it('empties tables that depend on copied ones, transitively', () => {
    const keys = [{ child: 'kept_session', parent: 'profiles' }, { child: 'kept_child', parent: 'kept_session' }]
    expect(truncationSet(['profiles'], ['profiles', 'kept_session', 'kept_child', 'other'], keys).sort()).toEqual(['kept_child', 'kept_session', 'profiles'])
  })

  it('reports schema drift in both directions', () => {
    const col = (column_name: string, udt_name = 'text', extra: object = {}) => ({
      column_name, data_type: udt_name, udt_name, is_generated: 'NEVER', identity_generation: null, is_nullable: 'YES', column_default: null, ...extra,
    })
    const diff = compareSchemas(
      new Map([['t', [col('id', 'int4'), col('new_col'), col('kind', 'int4')]], ['only_prod', [col('id')]], ['app_sessions', [col('token_hash')]]]),
      new Map([['t', [col('id', 'int4'), col('kind', 'text'), col('local_only', 'text', { is_nullable: 'NO' })]]]),
    )
    expect(diff.missingTables).toEqual(['only_prod']) // an excluded table is not required
    expect(diff.missingColumns).toEqual(['t.new_col'])
    expect(diff.changedColumns).toEqual(['t.kind (int4 -> text)'])
    expect(diff.requiredDestinationColumns).toEqual(['t.local_only'])
  })
})
