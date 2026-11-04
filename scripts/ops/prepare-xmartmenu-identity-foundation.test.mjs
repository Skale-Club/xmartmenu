import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { buildFoundationSql, captureReview, CONTROL_SQL, FOUNDATION_PRELUDE, foundationTransaction, identitySourceEvidence, migrationSources, nativeIdentityMigrationSql, preservedManifestSql, REVIEWED_ENGAGEMENT_TABLES, validateReview } from './prepare-xmartmenu-identity-foundation.mjs'
import { SEQUENCES, SOURCE_PROJECT, TABLES } from './xmartmenu-source-protocol.mjs'

function fixture() {
  const hash = 'a'.repeat(64), counts = Object.fromEntries(TABLES.map(name => [name, 0]))
  Object.assign(counts, { profiles: 7, tenants: 3, products: 56, orders: 2, order_items: 6 })
  const manifest = { version: 1, publicTableCount: 47, counts, digests: Object.fromEntries(TABLES.map(name => [name, hash])),
    criticalDigests: Object.fromEntries(['auth_ids', 'order_items', 'orders', 'product_tenants', 'profile_authority', 'tenants'].map(name => [name, hash])),
    functionDigest: hash, authIdCount: 7, orphanProfiles: 0, authWithoutProfile: 0, roles: { superadmin: 1, 'store-admin': 3, customer: 3 },
    orderTotals: [{ status: 'cancelled', currency: null, count: 1, total: '247.90' }, { status: 'pending', currency: null, count: 1, total: '77.90' }],
    sequenceCount: 2, sequences: Object.fromEntries(Object.entries(SEQUENCES).map(([name, table]) => [name, { type: 'bigint', start: '1', increment: '1', minimum: '1', maximum: '9223372036854775807', cache: '1', cycle: false, ownership: 'a', tableSchema: 'public', table, column: 'id', lastValue: '1', isCalled: false }])),
    ledgerCount: 92, ledgerLatest: '20261027097000', ledgerDigest: hash }
  const capturedAt = new Date(Math.floor(Date.now()/1000)*1000).toISOString()
  return { manifest, review: { version: 1, sourceProject: SOURCE_PROJECT, capturedAt, profilesDigest: hash, authorityDigest: hash,
    authIdsDigest: hash, users: Array.from({ length: 7 }, (_, index) => ({ id: randomUUID(), disabled: index === 0 })), readOnlySnapshot: true } }
}

test('default and explicit plan never connect or output private SQL; arbitrary execute refuses', () => {
  for (const args of [[], ['--plan']]) {
    const result = spawnSync(process.execPath, ['scripts/ops/prepare-xmartmenu-identity-foundation.mjs', ...args], { encoding: 'utf8' })
    assert.equal(result.status, 0); assert.match(result.stdout, /PLAN ONLY/)
  }
  const refused = spawnSync(process.execPath, ['scripts/ops/prepare-xmartmenu-identity-foundation.mjs', '--apply'], { encoding: 'utf8' })
  assert.equal(refused.status, 2); assert.equal(refused.stdout, '')
})

test('source review accepts exactly seven unique IDs, booleans and matching authority', () => {
  const { manifest, review } = fixture()
  assert.equal(validateReview(review, manifest), review)
  for (const mutate of [r => r.users.push(r.users[0]), r => r.users[1].id = r.users[0].id, r => r.users[0].disabled = 'false',
    r => r.users[0].email = 'not-an-owner-proof', r => r.sourceProject = 'other', r => r.readOnlySnapshot = false,
    r => r.profilesDigest = 'b'.repeat(64), r => r.authorityDigest = 'b'.repeat(64), r => r.authIdsDigest = 'b'.repeat(64),
    r => r.users[0].id = "');SELECT 1;--", r => r.capturedAt = new Date(Date.now()-301000).toISOString(),
    r => r.capturedAt = new Date(Date.now()+10000).toISOString()]) {
    const changed = structuredClone(review); mutate(changed)
    assert.throws(() => validateReview(changed, manifest))
  }
})

test('exact source controls preserve active bans, deletion and mandatory password reset without passwords', () => {
  assert.match(CONTROL_SQL, /banned_until>transaction_timestamp\(\)/)
  assert.match(CONTROL_SQL, /deleted_at IS NOT NULL/)
  assert.match(CONTROL_SQL, /must_change_password/)
  assert.doesNotMatch(CONTROL_SQL, /encrypted_password|email|phone|identities|raw_app_meta_data/)
  assert.match(CONTROL_SQL, /LIMIT 8$/)
})

test('the unchanged three migration bodies match normalized Git source pins', async () => {
  const sources = await migrationSources()
  assert.equal(sources.length, 3)
  assert.deepEqual(sources.map(row => row.version), ['20261103190000', '20261103200000', '20261103210000'])
  for (const { sql } of sources) assert.doesNotMatch(sql, /\b(?:ALTER ROLE|CREATE ROLE|PASSWORD|INSERT INTO|UPDATE public|DELETE FROM)\b/i)
})

test('post proof excludes exactly four new tables and only the three new ledger rows', () => {
  const sql = preservedManifestSql()
  assert.equal((sql.match(/version NOT IN/g) ?? []).length, 3)
  assert.equal((sql.match(/c.relname NOT IN/g) ?? []).length, 1)
  assert.match(sql, /app_accounts','app_identity_bindings','app_sessions','app_identity_challenges/)
  assert.match(sql, /pg_get_functiondef/)
  assert.match(sql, /last_value::text AS last_value,is_called/)
})

test('additive preparation defaults to empty accounts and preserves roles/business data before commit', async () => {
  const { manifest } = fixture(), sql = await buildFoundationSql(manifest)
  assert.ok(sql.startsWith('BEGIN;')); assert.ok(sql.endsWith('COMMIT;\n'))
  assert.match(sql, /LOCK TABLE public\.ai_generation_logs/)
  assert.match(sql, /SET LOCAL ROLE xmartmenu_owner/)
  assert.match(sql, /count\(\*\) FROM public\.app_accounts\)<>0/)
  assert.doesNotMatch(sql, /INSERT INTO public\.app_accounts|ALTER ROLE|CREATE ROLE|app_identity_bindings\(project_id/)
  assert.match(sql, /FROM identity_before\) IS DISTINCT FROM \(SELECT manifest FROM identity_after/)
  assert.match(sql, /FROM pg_roles r/)
  assert.doesNotMatch(sql, /to_jsonb\(r\).*FROM pg_authid/)
})

test('reviewed bootstrap keeps exact IDs/disabled state/version zero and creates no binding or session', async () => {
  const { manifest, review } = fixture(), sql = await buildFoundationSql(manifest, review)
  for (const row of review.users) assert.ok(sql.includes(row.id))
  assert.match(sql, /INSERT INTO public\.app_accounts\(id,disabled_at,session_version\)/)
  assert.match(sql, /CASE WHEN \(r->>'disabled'\)::boolean/)
  assert.match(sql, /interval '5 minutes'/)
  assert.match(sql, /EXCEPT SELECT id FROM auth.users/)
  assert.match(sql, /count\(\*\) FROM public\.app_accounts\)<>7/)
  assert.doesNotMatch(sql, /INSERT INTO public\.app_identity_bindings|INSERT INTO public\.app_sessions/)
})

test('public quiet prelude is separated before private libpq SQL and rejects unreviewed audit modules', async () => {
  const { manifest, review } = fixture(), parts = await foundationTransaction(manifest, review)
  assert.equal(parts.publicPrelude, FOUNDATION_PRELUDE)
  for (const { id } of review.users) { assert.ok(!parts.publicPrelude.includes(id)); assert.ok(parts.privateSql.includes(id)) }
  assert.match(parts.publicPrelude, /pg_stat_statements.track='none'/)
  assert.match(parts.publicPrelude, /log_statement='none'/)
  assert.match(parts.publicPrelude, /session_preload_libraries/)
  assert.match(parts.publicPrelude, /local_preload_libraries/)
  assert.match(parts.publicPrelude, /identity_foundation_prepared.*ON COMMIT DROP/)
  assert.ok(parts.privateSql.indexOf('Public identity prelude transaction required') < parts.privateSql.indexOf('LOCK TABLE'))
  assert.ok(parts.privateSql.endsWith('COMMIT;\n'))
})

function engagementDrift(manifest) {
  const source = structuredClone(manifest)
  for (const name of REVIEWED_ENGAGEMENT_TABLES) { source.counts[name] += 3; source.digests[name] = 'b'.repeat(64) }
  return source
}

test('strict source comparison remains the default even for only engagement drift', () => {
  const { manifest } = fixture(), source = engagementDrift(manifest)
  assert.throws(() => identitySourceEvidence(source, manifest), /require reconciliation/)
  assert.throws(() => identitySourceEvidence(source, manifest, 'true'), /require reconciliation/)
})

test('explicit identity-only mode admits exactly three engagement tables and emits private aggregate/hash evidence', () => {
  const { manifest } = fixture(), source = engagementDrift(manifest), before = structuredClone({ manifest, source })
  const proof = identitySourceEvidence(source, manifest, true)
  assert.equal(proof.purpose, 'identity-foundation-only')
  assert.equal(proof.allOtherTableDigestsMatched, 44); assert.equal(proof.criticalGroupsMatched, 6)
  assert.equal(proof.finalFullReconciliationRequired, true)
  assert.deepEqual(proof.tables.map(row => row.name), ['menu_events', 'menu_sessions', 'scan_events'])
  for (const row of proof.tables) { assert.equal(row.sourceCount, row.candidateCount+3); assert.match(row.sourceDigest, /^[a-f0-9]{64}$/) }
  assert.match(proof.sourceManifestSha256, /^[a-f0-9]{64}$/)
  assert.notEqual(proof.sourceManifestSha256, proof.candidateManifestSha256)
  assert.doesNotMatch(JSON.stringify(proof), /email|phone|password|userId|authToken/)
  assert.deepEqual({ manifest, source }, before)
})

test('all44 other complete table digests and counts remain exact in reviewed mode', () => {
  const { manifest } = fixture()
  for (const name of TABLES.filter(name => !REVIEWED_ENGAGEMENT_TABLES.includes(name))) {
    for (const field of ['digests', 'counts']) {
      const source = engagementDrift(manifest)
      source[field][name] = field === 'digests' ? 'c'.repeat(64) : source.counts[name]+1
      assert.throws(() => identitySourceEvidence(source, manifest, true), `${field}.${name}`)
    }
  }
})

test('all six authority groups, roles, money, ledger, functions and sequence definitions/states stay exact', () => {
  const { manifest } = fixture()
  const mutations = [
    ...Object.keys(manifest.criticalDigests).map(name => value => { value.criticalDigests[name] = 'c'.repeat(64) }),
    value => { value.roles.superadmin = 2 }, value => { value.orderTotals[0].total = '248.00' },
    value => { value.functionDigest = 'c'.repeat(64) }, value => { value.ledgerDigest = 'c'.repeat(64) },
    value => { value.ledgerCount++ }, value => { value.authIdCount-- }, value => { value.orphanProfiles++ },
    value => { value.sequences.audit_events_id_seq.lastValue = '2' },
    value => { value.sequences.audit_events_id_seq.isCalled = true },
    value => { value.sequences.audit_events_id_seq.increment = '2' },
  ]
  for (const mutate of mutations) {
    const source = engagementDrift(manifest); mutate(source)
    assert.throws(() => identitySourceEvidence(source, manifest, true))
  }
})

test('reviewed capture requires a private evidence sink before reading env or contacting source', async () => {
  const { manifest } = fixture()
  await assert.rejects(captureReview('must-not-be-read.env', manifest, { allowReviewedEngagementDrift: true }), /evidence sink required/)
})

test('native projection preserves canonical migration files and never creates browser roles', async () => {
  const sources = await migrationSources(), before = structuredClone(sources)
  for (const row of sources) {
    const sql = nativeIdentityMigrationSql(row)
    assert.doesNotMatch(sql, /CREATE ROLE|ALTER ROLE|DROP ROLE/i)
    if (row.version === '20261103200000') assert.equal(sql, row.sql)
    else {
      assert.match(sql, /IF to_regrole\('anon'\) IS NOT NULL THEN EXECUTE 'REVOKE ALL/)
      assert.doesNotMatch(sql, /FROM PUBLIC, anon, authenticated/)
      assert.match(sql, /FROM PUBLIC, authenticated/)
    }
  }
  assert.deepEqual(sources, before)
  assert.throws(() => nativeIdentityMigrationSql({ ...sources[0], sql: sources[0].sql+'\n' }))
})
