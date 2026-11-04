import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, chmodSync } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import { authenticateArchive, decryptArchive, encryptArchive, MAX_ARCHIVE_BYTES, reviewedToc } from './xmartmenu-archive-crypto.mjs'
import { assertManifest, assertPacket, canonical, compareManifests, compatibilitySql, MANIFEST_SQL, publicCa, SEQUENCES, SOURCE_PROJECT, sourceConfig, TABLES } from './xmartmenu-source-protocol.mjs'
import { sshEnvironment } from './xmartmenu-database-rehearsal.mjs'

const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash'
const directory = mkdtempSync(join(tmpdir(), 'xmartmenu-rehearsal-policy-'))
const runner = resolve('scripts/ops/xmartmenu-database-rehearsal.sh')
const driver = resolve('scripts/ops/xmartmenu-database-rehearsal.mjs')
const run = (text, args = []) => spawnSync(bash, ['-c', text, '--', ...args], { encoding: 'utf8', timeout: 4000 })
after(() => {
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + '/xmartmenu-rehearsal-policy-') || resolve(directory).startsWith(resolve(tmpdir()) + '\\xmartmenu-rehearsal-policy-'))
  rmSync(directory, { recursive: true, force: true })
})
export function syntheticManifest() {
  const hash = 'a'.repeat(64), counts = Object.fromEntries(TABLES.map(name => [name, 0]))
  Object.assign(counts, { profiles: 7, tenants: 3, products: 56, orders: 2, order_items: 6 })
  return { version: 1, publicTableCount: 47, counts, digests: Object.fromEntries(TABLES.map(name => [name, hash])),
    criticalDigests: Object.fromEntries(['auth_ids','order_items','orders','product_tenants','profile_authority','tenants'].map(name => [name, hash])),
    functionDigest: hash, authIdCount: 7, orphanProfiles: 0, authWithoutProfile: 0, roles: { superadmin: 1, 'store-admin': 3, customer: 3 },
    orderTotals: [{ status: 'cancelled', currency: null, count: 1, total: '247.90' }, { status: 'pending', currency: null, count: 1, total: '77.90' }], sequenceCount: 2,
    sequences: Object.fromEntries(Object.entries(SEQUENCES).map(([name, table]) => [name,{type:'bigint',start:'1',increment:'1',minimum:'1',maximum:'9223372036854775807',cache:'1',cycle:false,ownership:'a',tableSchema:'public',table,column:'id',lastValue:name==='audit_events_id_seq'?'34':'1',isCalled:name==='audit_events_id_seq'}])),ledgerCount: 92, ledgerLatest: '20261027097000', ledgerDigest: hash }
}
test('both launchers default to offline plans and reject host/owner/image/source override attempts', () => {
  for (const [binary, script] of [[bash, runner], [process.execPath, driver]]) {
    for (const args of [[], ['--plan']]) {
      const result = spawnSync(binary, [script, ...args], { encoding: 'utf8', timeout: 3000 })
      assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /PLAN ONLY/)
    }
    for (const args of [['--apply'], ['--execute-reviewed-rehearsal','--host','other']]) {
      assert.equal(spawnSync(binary, [script, ...args], { encoding: 'utf8', timeout: 3000 }).status, 2)
    }
  }
})
test('source guard forces session5432/verified TLS and ignores legacy aliases or unrelated secrets', () => {
  const database = new URL('postgresql://aws-1-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require')
  database.username = `postgres.${SOURCE_PROJECT}`; database.password = randomUUID()
  const env = { SUPABASE_PROJECT_REF: SOURCE_PROJECT, NEXT_PUBLIC_SUPABASE_URL: `https://${SOURCE_PROJECT}.supabase.co`, DATABASE_URL: database.href }
  const config = sourceConfig(env)
  assert.equal(new URL(config.url).port, '5432'); assert.equal(new URL(config.url).search, '')
  assert.match(config.environment, /PGSSLMODE=verify-full/); assert.match(config.environment, /default_transaction_read_only=on/)
  for (const patch of [{ SUPABASE_PROJECT_REF: 'other' }, { NODE_TLS_REJECT_UNAUTHORIZED: '0' }, { DATABASE_URL: env.DATABASE_URL + '&sslmode=disable' }, { DATABASE_URL: env.DATABASE_URL + '&host=other' }, { DATABASE_URL: env.DATABASE_URL.replace('/postgres?', '/other?') }]) assert.throws(() => sourceConfig({ ...env, ...patch }))
  const sanitized = sshEnvironment({ PATH: '/bin', SSH_AUTH_SOCK: 'existing-agent', ProgramData: 'C:/ProgramData', DATABASE_URL: 'private', GOOGLE_APPLICATION_CREDENTIALS: 'private', COOLIFY_TOKEN: 'private' })
  assert.deepEqual(sanitized, { PATH: '/bin', SSH_AUTH_SOCK: 'existing-agent', ProgramData: 'C:/ProgramData' })
  assert.deepEqual(sshEnvironment({ PROGRAMDATA: 'C:/ProgramData', Path: '/bin', database_url: 'private' }), { PROGRAMDATA: 'C:/ProgramData', Path: '/bin' })
})
test('packet admission pins the public CA and refuses added env aliases, weakened TLS or changed UUID shape', () => {
  const ca = readFileSync(new URL('fixtures/supabase-prod-ca.crt', import.meta.url), 'utf8')
  const database = new URL(`postgresql://db.${SOURCE_PROJECT}.supabase.co:5432/postgres`)
  database.username = 'postgres'; database.password = randomUUID()
  const environment = sourceConfig({ SUPABASE_PROJECT_REF: SOURCE_PROJECT, NEXT_PUBLIC_SUPABASE_URL: `https://${SOURCE_PROJECT}.supabase.co`, DATABASE_URL: database.href }).environment
  const packet = { ca, environment, manifest: syntheticManifest(), snapshot: '00000001-00000002-1', authIds: Array.from({ length: 7 }, () => randomUUID()) }
  assert.equal(publicCa(ca), ca); assert.equal(assertPacket(packet), packet)
  for (const patch of [{ ca: 'untrusted' }, { environment: environment.replace('verify-full', 'disable') }, { environment: environment + '\nDATABASE_URL=untrusted' }, { authIds: [...packet.authIds.slice(0, 6), packet.authIds[0]] }]) assert.throws(() => assertPacket({ ...packet, ...patch }))
})
test('all47 row digests,6 UUID authority groups, NULL totals/functions/ledger must match; report has no identifiers/digests', () => {
  const source = syntheticManifest(), target = structuredClone(source)
  assert.equal(assertManifest(source), source)
  const report = compareManifests(source, target)
  assert.equal(report.loginMigrated, false); assert.equal(report.temporaryResourcesRemoved, true)
  assert.equal(report.fullPublicRowDigestsMatched, 47)
  assert.equal(report.sequenceStatesMatched, 2)
  assert.equal(report.sequenceSnapshotGuarantee, 'not_mvcc_requires_final_writer_freeze')
  assert.equal(JSON.stringify(report).includes('a'.repeat(64)), false)
  for (const change of [m => { m.digests.platform_ai_settings = 'b'.repeat(64) }, m => { m.criticalDigests.profile_authority = 'b'.repeat(64) }, m => { m.functionDigest = 'b'.repeat(64) }, m => { m.ledgerDigest = 'b'.repeat(64) }, m => { m.orderTotals[0].currency = 'USD' }, m => { m.roles.superadmin = 2 }, m => { m.sequenceCount = 1 },m=>{m.sequences.audit_events_id_seq.lastValue='35'},m=>{m.sequences.ai_usage_events_id_seq.isCalled=true},m=>{m.sequences.audit_events_id_seq.table='profiles'}]) {
    const changed = structuredClone(source); change(changed); assert.throws(() => compareManifests(source, changed))
  }
  assert.equal(JSON.stringify(canonical(source)), JSON.stringify(canonical(target)))
})
test('auth compatibility copies original UUIDs only and never passwords, providers or sessions', () => {
  const ids = Array.from({ length: 7 }, () => randomUUID())
  const sql = compatibilitySql(ids)
  assert.match(sql, /CREATE TABLE auth.users\(id uuid PRIMARY KEY\)/)
  assert.match(sql, /auth\.uid\(\).*NULL::uuid/)
  assert.match(sql, /auth\.role\(\).*NULL::text/)
  assert.equal((sql.match(/NOLOGIN NOBYPASSRLS/g) || []).length, 2)
  assert.doesNotMatch(sql, /email|phone|password|refresh|sessions|identities/i)
  assert.throws(() => compatibilitySql([...ids.slice(0, 6), "');DROP TABLE auth.users;--"]))
  assert.throws(() => assertPacket({ snapshot: 'malformed', authIds: ids }))
  assert.match(MANIFEST_SQL, /auth\.users/); assert.doesNotMatch(MANIFEST_SQL, /auth\.(sessions|refresh_tokens|identities)|\bemail\b/i)
})
test('AES-GCM roundtrip preserves bytes and rejects tampering before any plaintext output', async () => {
  const path = join(directory, 'archive.gcm'), key = randomBytes(32).toString('hex'), plain = randomBytes(32768)
  await encryptArchive(Readable.from([plain]), path, key)
  assert.equal(readFileSync(path).includes(plain.subarray(0, 128)), false)
  await authenticateArchive(path, key)
  const chunks = []
  await decryptArchive(path, new Writable({ write(chunk, _, done) { chunks.push(Buffer.from(chunk)); done() } }), key)
  assert.deepEqual(Buffer.concat(chunks), plain)
  chmodSync(path, 0o600); const tampered = readFileSync(path); tampered[25] ^= 1; writeFileSync(path, tampered); chmodSync(path, 0o400)
  let emitted = 0
  await assert.rejects(decryptArchive(path, new Writable({ write(chunk, _, done) { emitted += chunk.length; done() } }), key))
  assert.equal(emitted, 0)
  await assert.rejects(authenticateArchive(path, randomBytes(32).toString('hex')))
})
test('encrypted archive refuses overflow without allocating the whole archive', async () => {
  const chunk = Buffer.alloc(1024 * 1024)
  const input = Readable.from((async function* () { for (let i = 0; i <= MAX_ARCHIVE_BYTES / chunk.length; i++) yield chunk })())
  await assert.rejects(encryptArchive(input, join(directory, 'oversized.gcm'), randomBytes(32).toString('hex')))
})
test('archive TOC skips exactly one public schema and rejects hosted/global objects or changed table shape', () => {
  const fixture = ['; synthetic fixture','1; 2615 1 SCHEMA - public postgres','2; 2615 2 SCHEMA - supabase_migrations postgres', ...TABLES.map((name, i) => `${i + 3}; 1259 ${i + 3} TABLE public ${name} postgres`),...Object.keys(SEQUENCES).flatMap((name,i)=>['SEQUENCE','SEQUENCE OWNED BY','SEQUENCE SET'].map((kind,j)=>`${100+i*3+j}; 1259 ${100+i*3+j} ${kind} public ${name} postgres`))].join('\n')
  const list = reviewedToc(fixture)
  assert.match(list, /;1; 2615 1 SCHEMA - public/)
  assert.throws(() => reviewedToc(fixture + '\n999; 3466 99 EVENT TRIGGER - ensure_rls postgres'))
  assert.throws(() => reviewedToc(fixture + '\n999; 1259 99 TABLE auth sessions postgres'))
  assert.throws(() => reviewedToc(fixture.replace('TABLE public users', 'TABLE public other').replace('TABLE public profiles', 'TABLE public other')))
  assert.throws(() => reviewedToc(fixture.replace('SEQUENCE SET public audit_events_id_seq','SEQUENCE SET public unreviewed_seq')))
})
test('timeout preamble filter preserves SQL/COPY bodies and refuses changed pg_restore preambles', () => {
  const script = readFileSync(runner, 'utf8').replace(/\r\n/g, '\n')
  const filter = script.match(/--file=-[^\n]*\| awk '([\s\S]*?)\n  '/)?.[1]
  assert.ok(filter)
  const fixture = join(directory, 'restore.fixture')
  const preamble = ['statement_timeout','lock_timeout','idle_in_transaction_session_timeout','transaction_timeout'].map(name => `SET ${name} = 0;`).join('\n')
  writeFileSync(fixture, `${preamble}\n-- Name: untouched\nCOPY fixture FROM stdin;\nSET statement_timeout = 0;\n\\.\n`)
  const filtered = run('awk "$1" "$2"', [filter, fixture])
  assert.equal(filtered.status, 0, filtered.stderr)
  assert.equal(filtered.stdout, '-- Name: untouched\nCOPY fixture FROM stdin;\nSET statement_timeout = 0;\n\\.\n')
  writeFileSync(fixture, 'SET statement_timeout = 0;\n-- Name: untouched\n')
  assert.equal(run('awk "$1" "$2"', [filter, fixture]).status, 2)
})
test('Docker crypto and TOC adapters explicitly keep stdin open for their private pipelines', () => {
  const source = readFileSync(runner, 'utf8').replace(/\r\n/g, '\n')
  const helper = source.slice(source.indexOf('run_helper() {'), source.indexOf('\nIFS= read -r -t 30 packet'))
  const client = source.slice(source.indexOf('offline_client() {'), source.indexOf('\n# This separate client'))
  const result = run(`set -Eeuo pipefail
helper=synthetic; client=synthetic; label_key=synthetic; nonce=synthetic; code_dir=/synthetic; work=/synthetic; helper_image=synthetic; image=synthetic
timeout() { shift 2; "$@"; }
docker() { local interactive=false; for arg in "$@"; do if [[ $arg == -i || $arg == --interactive ]]; then interactive=true; fi; done; [[ $interactive == true ]] || return 2; cat; }
${helper}
${client}
printf 'synthetic-private-input' | run_helper encrypt
printf 'synthetic-archive-input' | offline_client pg_restore --list`)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'synthetic-private-inputsynthetic-archive-input')
})
test('cleanup removes only matching run labels and exact tmpfs, never existing candidates/volumes/backups', () => {
  const source = readFileSync(runner, 'utf8').replace(/\r\n/g, '\n')
  const cleanup = source.slice(source.indexOf('cleanup() {'), source.indexOf('\ntrap cleanup EXIT'))
  const record = join(directory, 'cleanup-record')
  const result = run(`set -Eeuo pipefail
record=$1; client=xmartmenu-rehearsal-offline-client; helper=xmartmenu-rehearsal-offline-crypto; target=xmartmenu-rehearsal-offline-target
nonce=offline; label_key=com.skale.xmartmenu-db-rehearsal; work=/tmp/xmartmenu-db-rehearsal.DOESNOTX
docker() { if [[ $1 == inspect ]]; then printf 'offline'; elif [[ $1 == rm ]]; then printf '%s\\n' "$*" >>"$record"; else return 2; fi; }
${cleanup}
cleanup`, [record])
  assert.equal(result.status, 0, result.stderr)
  assert.equal(readFileSync(record, 'utf8'), ['rm -f xmartmenu-rehearsal-offline-client','rm -f xmartmenu-rehearsal-offline-crypto','rm -f xmartmenu-rehearsal-offline-target',''].join('\n'))
  assert.doesNotMatch(cleanup, /volume\s+(?:rm|prune)|backups|e12scyfsrp822dag7m9wwd4x|7l8mjbkk16mk0ss9dviw9lzj|rm -rf/)
})
