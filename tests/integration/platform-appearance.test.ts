// Disposable CI database only. No dotenv, provider, migration runner or live import.
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { readPlatformAppearance } from '../../src/lib/data/platform-appearance'
import { createPlatformAppearancePool } from '../../src/lib/data/platform-appearance-runtime'

const raw = process.env.IDENTITY_TEST_DATABASE_URL
if (!raw) throw new Error('Explicit disposable CI target required')
const target = new URL(raw)
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/xmartmenu_identity_test'
  || target.search || target.hash) throw new Error('Not an isolated platform appearance test target')
const admin = new pg.Pool({ connectionString: raw, max: 1, connectionTimeoutMillis: 5_000, statement_timeout: 5_000 })
const reader = createPlatformAppearancePool({ NODE_ENV: 'production', PROD_DATABASE_HOST: target.hostname,
  PROD_DATABASE_NAME: 'xmartmenu_identity_test', PLATFORM_APPEARANCE_DATABASE_URL: raw, PLATFORM_APPEARANCE_DATABASE_SSL: 'disable' })
const id = randomUUID()

before(async () => {
  // Actual historical table/index DDL, omitting seed, Auth policy and trigger
  // dependencies. 045 and 047 add the exact two columns used by this boundary.
  const original = await readFile(new URL('../../supabase/migrations/004_platform_settings.sql', import.meta.url), 'utf8')
  await admin.query(original.slice(original.indexOf('CREATE TABLE'), original.indexOf('-- Insert English-first')))
  for (const file of ['045_platform_settings_columns.sql', '047_platform_favicon.sql']) {
    await admin.query(await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'))
  }
  await admin.query('CREATE ROLE appearance_reader NOLOGIN; GRANT USAGE ON SCHEMA public TO appearance_reader; GRANT SELECT(cta_color, favicon_url) ON public.platform_settings TO appearance_reader')
})
after(async () => { await reader.end(); await admin.end() })

test('independent PostgreSQL reads restored IDs without Auth or provider credentials', async () => {
  assert.equal(await readPlatformAppearance(text => reader.query(text)), null)
  await admin.query('INSERT INTO public.platform_settings(id, cta_color, favicon_url) VALUES($1,$2,$3)', [id, '#123456', 'https://media.example.test/icon.webp'])
  assert.deepEqual(await readPlatformAppearance(text => reader.query(text)), { cta_color: '#123456', favicon_url: 'https://media.example.test/icon.webp' })
  assert.equal((await admin.query('SELECT id FROM public.platform_settings')).rows[0].id, id)
})
test('runtime read-only connection rejects writes even with a privileged test login', async () => {
  await assert.rejects(reader.query("UPDATE public.platform_settings SET cta_color='#ffffff'"), { code: '25006' })
  assert.equal((await readPlatformAppearance(text => reader.query(text)))?.cta_color, '#123456')
})
test('the actual PostgreSQL statement deadline cancels stalled reads and releases the connection', async () => {
  const client = await reader.connect()
  try {
    assert.equal((await client.query('SHOW statement_timeout')).rows[0].statement_timeout, '5s')
    assert.equal((await client.query('SHOW lock_timeout')).rows[0].lock_timeout, '2s')
    await client.query('SET statement_timeout=50')
    await assert.rejects(client.query('SELECT pg_sleep(1)'), { code: '57014' })
    assert.equal((await readPlatformAppearance(text => client.query(text)))?.cta_color, '#123456')
  } finally { await client.query('SET statement_timeout=5000'); client.release() }
})
test('dedicated reader works with column privileges and cannot read other platform settings', async () => {
  const client = await reader.connect()
  try {
    await client.query('SET ROLE appearance_reader')
    assert.equal((await readPlatformAppearance(text => client.query(text)))?.cta_color, '#123456')
    await assert.rejects(client.query('SELECT landing FROM public.platform_settings'), { code: '42501' })
  } finally { await client.query('RESET ROLE'); client.release() }
})
test('changes are visible immediately without a shared stale cache or ID replacement', async () => {
  await admin.query('UPDATE public.platform_settings SET cta_color=$1, favicon_url=NULL WHERE id=$2', ['#654321', id])
  assert.deepEqual(await readPlatformAppearance(text => reader.query(text)), { cta_color: '#654321', favicon_url: null })
})
test('ambiguous restored singleton fails closed without silently selecting another row', async () => {
  await assert.rejects(admin.query('INSERT INTO public.platform_settings DEFAULT VALUES'), { code: '23505' })
  await admin.query('DROP INDEX public.platform_settings_singleton; INSERT INTO public.platform_settings DEFAULT VALUES')
  await assert.rejects(readPlatformAppearance(text => reader.query(text)), /^Error: Platform appearance is unavailable$/)
})
