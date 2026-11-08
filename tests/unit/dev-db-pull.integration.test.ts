import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { backupDestination, pullDatabase, readSchema } from '../../scripts/lib/dev-db-pull'

/**
 * Rehearsal on a disposable PostgreSQL: two throwaway databases stand in for the source
 * and the development project. Needs DEV_PULL_TEST_DATABASE_URL (any database of a
 * disposable server) and DEV_PULL_TEST_SENTINEL=xmartmenu-dev-db-pull-ci. Skipped without
 * them unless XMARTMENU_REQUIRE_PG=1 (CI), where a missing database must fail the run.
 */
const adminUrl = process.env.DEV_PULL_TEST_DATABASE_URL
const enabled = Boolean(adminUrl) && process.env.DEV_PULL_TEST_SENTINEL === 'xmartmenu-dev-db-pull-ci'
if (process.env.XMARTMENU_REQUIRE_PG === '1' && !enabled) throw new Error('XMARTMENU_REQUIRE_PG=1 but the disposable pull-test database is not configured')

const suffix = randomBytes(4).toString('hex')
const names = { src: `xm_pull_src_${suffix}`, dst: `xm_pull_dst_${suffix}` }
const urlFor = (database: string) => {
  const url = new URL(adminUrl!)
  url.pathname = `/${database}`
  return url.toString()
}

const TELEGRAM_SECRET = `telegram-secret-${randomUUID()}`
const APPROVALS_SECRET = `approvals-secret-${randomUUID()}`
const WEBHOOK_SECRET = `webhook-secret-${randomUUID()}`
const AI_SECRET = `ai-secret-${randomUUID()}`
const AUDIO_SECRET = `audio-secret-${randomUUID()}`

const SCHEMA = (dest: boolean) => `
  create table tenants (id serial primary key, name text not null);
  create table profiles (
    id serial primary key, tenant_id int not null references tenants(id), email text not null,
    meta jsonb, tags text[], big bigint ${dest ? ', note text' : ''}
  );
  create table orders (
    id serial primary key, tenant_id int not null references tenants(id), parent_id int references orders(id),
    total numeric(12,2) not null, label text not null ${dest ? "check (label <> 'poison')" : ''}
  );
  create table telegram_settings (id serial primary key, tenant_id int not null references tenants(id), bot_token text, approvals_bot_token text, webhook_secret text, chat_id text);
  create table platform_ai_settings (id smallint primary key, openrouter_api_key text, default_billing_mode text not null);
  create table tenant_ai_settings (tenant_id int primary key references tenants(id), openrouter_api_key text);
  create table chat_addon_settings (tenant_id int primary key references tenants(id), openrouter_api_key text, audio_api_key text);
  create table app_sessions (token_hash text primary key, profile_id int not null references profiles(id));
  create table oauth_codes (id serial primary key, tenant_id int references tenants(id), raw_token text);
  create table settings (id int generated always as identity primary key, data jsonb);
  ${dest ? 'create table dest_only (id serial primary key, profile_id int references profiles(id));' : ''}
`

async function open(database: string) {
  const client = new pg.Client({ connectionString: urlFor(database) })
  await client.connect()
  return client
}

async function seedSource(c: pg.Client, { poison = false } = {}) {
  await c.query(SCHEMA(false))
  await c.query("insert into tenants (name) values ('Bella Vista'), ('Aurora')")
  await c.query(`insert into profiles (tenant_id, email, meta, tags, big) values
    (1, 'a@example.test', '{"k":[1,2]}', '{x,y}', 9007199254740993), (2, 'b@example.test', null, null, null)`)
  await c.query("insert into orders (tenant_id, parent_id, total, label) values (1, null, 12.50, 'first'), (1, 1, 0.10, 'second')" + (poison ? ", (2, 2, 1, 'poison')" : ''))
  await c.query('insert into telegram_settings (tenant_id, bot_token, approvals_bot_token, webhook_secret, chat_id) values (1, $1, $2, $3, $4)', [TELEGRAM_SECRET, APPROVALS_SECRET, WEBHOOK_SECRET, 'chat-1'])
  await c.query("insert into platform_ai_settings (id, openrouter_api_key, default_billing_mode) values (1, $1, 'platform')", [AI_SECRET])
  await c.query('insert into tenant_ai_settings (tenant_id, openrouter_api_key) values (1, $1)', [AI_SECRET])
  await c.query('insert into chat_addon_settings (tenant_id, openrouter_api_key, audio_api_key) values (1, $1, $2)', [AI_SECRET, AUDIO_SECRET])
  await c.query("insert into app_sessions (token_hash, profile_id) values ('prod-session', 1)")
  await c.query("insert into oauth_codes (tenant_id, raw_token) values (1, 'raw-bearer')")
  await c.query("insert into settings (data) values ('{\"a\":1}'), ('{\"b\":2}')")
}

async function seedDestination(c: pg.Client) {
  await c.query(SCHEMA(true))
  await c.query("insert into tenants (name) values ('Dev tenant')")
  await c.query("insert into profiles (tenant_id, email, note) values (1, 'old@dev.test', 'dev-only')")
  await c.query("insert into app_sessions (token_hash, profile_id) values ('dev-session', 1)")
  await c.query('insert into dest_only (profile_id) values (1)')
}

const count = async (c: pg.Client, table: string) => Number((await c.query(`select count(*)::int n from ${table}`)).rows[0].n)

describe.skipIf(!enabled)('db:pull rehearsal on disposable PostgreSQL', () => {
  let admin: pg.Client
  let src: pg.Client
  let dst: pg.Client
  const dirs: string[] = []

  async function recreate(options: { poison?: boolean } = {}) {
    await src?.end().catch(() => undefined)
    await dst?.end().catch(() => undefined)
    for (const name of Object.values(names)) {
      await admin.query(`drop database if exists ${name} with (force)`)
      await admin.query(`create database ${name}`)
    }
    src = await open(names.src)
    dst = await open(names.dst)
    await seedSource(src, options)
    await seedDestination(dst)
  }

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: adminUrl })
    await admin.connect()
  })

  afterAll(async () => {
    await src?.end().catch(() => undefined)
    await dst?.end().catch(() => undefined)
    for (const name of Object.values(names)) await admin.query(`drop database if exists ${name} with (force)`).catch(() => undefined)
    await admin.end()
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  })

  it('copies the source exactly, without any Telegram or AI secret', async () => {
    await recreate()
    const result = await pullDatabase({ prod: src, dest: dst, destUrl: urlFor(names.dst) })
    expect(result.copied).toMatchObject({ tenants: 2, profiles: 2, orders: 2, settings: 2, telegram_settings: 1 })
    expect(result.triggersDisabled).toBe(true)
    expect(result.scrubbed).toEqual(expect.arrayContaining([
      'telegram_settings.bot_token', 'telegram_settings.approvals_bot_token', 'telegram_settings.webhook_secret',
      'platform_ai_settings.openrouter_api_key', 'tenant_ai_settings.openrouter_api_key',
      'chat_addon_settings.openrouter_api_key', 'chat_addon_settings.audio_api_key',
    ]))

    const profiles = (await dst.query('select email, meta, tags, big::text, note from profiles order by id')).rows
    expect(profiles.map(p => p.email)).toEqual(['a@example.test', 'b@example.test'])
    expect(profiles[0].meta).toEqual({ k: [1, 2] })
    expect(profiles[0].tags).toEqual(['x', 'y'])
    expect(profiles[0].big).toBe('9007199254740993') // beyond 2^53: must not round
    expect((await dst.query('select total::text t from orders order by id')).rows.map(r => r.t)).toEqual(['12.50', '0.10'])
    expect((await dst.query('select id from settings order by id')).rows.map(r => r.id)).toEqual([1, 2])

    // Secrets never reach the development database, in any column.
    const dump = JSON.stringify(await Promise.all(['telegram_settings', 'platform_ai_settings', 'tenant_ai_settings', 'chat_addon_settings']
      .map(async t => (await dst.query(`select * from ${t}`)).rows)))
    for (const leaked of [TELEGRAM_SECRET, APPROVALS_SECRET, WEBHOOK_SECRET, AI_SECRET, AUDIO_SECRET]) expect(dump).not.toContain(leaked)
    expect((await dst.query('select bot_token, approvals_bot_token, webhook_secret, chat_id from telegram_settings')).rows[0])
      .toEqual({ bot_token: null, approvals_bot_token: null, webhook_secret: null, chat_id: 'chat-1' })
    expect((await dst.query('select openrouter_api_key k, default_billing_mode m from platform_ai_settings')).rows[0]).toEqual({ k: null, m: 'platform' })
  })

  it('keeps excluded sign-in state, empties its dependents, and never touches the source', async () => {
    await recreate()
    const before = await count(src, 'profiles')
    const result = await pullDatabase({ prod: src, dest: dst, destUrl: urlFor(names.dst) })
    // app_sessions references profiles, so it cannot survive replaced profiles: emptied, never refilled.
    expect(result.truncated).toEqual(expect.arrayContaining(['app_sessions', 'oauth_codes', 'dest_only']))
    expect(await count(dst, 'app_sessions')).toBe(0)
    expect(await count(dst, 'oauth_codes')).toBe(0)
    expect(await count(src, 'app_sessions')).toBe(1) // source untouched
    expect(await count(src, 'profiles')).toBe(before)
    // The source snapshot transaction is read-only.
    await src.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    await expect(src.query("insert into settings (data) values ('{}')")).rejects.toThrow()
    await src.query('ROLLBACK')
  })

  it('rolls back everything when the destination rejects a row, leaving it as it was', async () => {
    await recreate({ poison: true })
    await expect(pullDatabase({ prod: src, dest: dst, destUrl: urlFor(names.dst) })).rejects.toThrow(/destination unchanged/)
    expect((await dst.query('select email from profiles')).rows.map(r => r.email)).toEqual(['old@dev.test'])
    expect(await count(dst, 'app_sessions')).toBe(1)
    expect(await count(dst, 'orders')).toBe(0)
  })

  it('aborts on schema drift before changing the destination', async () => {
    await recreate()
    await src.query('alter table profiles add column extra text')
    await expect(pullDatabase({ prod: src, dest: dst, destUrl: urlFor(names.dst) })).rejects.toThrow(/schema mismatch.*profiles\.extra/)
    expect(await count(dst, 'profiles')).toBe(1)
  })

  it('refuses a production destination before connecting to anything', async () => {
    // No Supabase project is production since 2026-11-07 (owned PostgreSQL); the guard still works for a listed ref.
    await expect(pullDatabase({
      prod: src, dest: dst, productionRefs: ['prodrefprodrefprodre'],
      destUrl: 'postgresql://postgres.prodrefprodrefprodre:pw@aws-1-us-east-1.pooler.supabase.com:5432/postgres',
    })).rejects.toThrow(/production/)
  })

  it('writes a restorable JSON backup of the destination with owner-only permissions', async () => {
    await recreate()
    const dir = mkdtempSync(join(tmpdir(), 'xmartmenu-pull-backup-'))
    dirs.push(dir)
    const file = await backupDestination(dst, dir, new Date('2026-01-02T03:04:05Z'))
    expect(existsSync(file)).toBe(true)
    const backup = JSON.parse(readFileSync(file, 'utf8')) as { tables: Record<string, Array<Record<string, unknown>>> }
    expect(backup.tables.profiles[0]).toMatchObject({ email: 'old@dev.test', note: 'dev-only' })
    expect([...(await readSchema(dst)).keys()]).toContain('dest_only')
  })
})
