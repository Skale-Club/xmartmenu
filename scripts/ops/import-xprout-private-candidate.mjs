#!/usr/bin/env node
import { assertTextSemantics, localeSql, persistentReport, TEXT_COLUMNS_SQL, textSemanticsSql } from './import-xprout-private-candidate.helper.mjs'
import { readFile } from 'node:fs/promises'
import { spawn, spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import { assertManifest, assertPacket, canonical, MANIFEST_SQL, publicCa, sha256, sourceConfig, SOURCE_CA_URL } from './xprout-source-protocol.mjs'

export const SSH_HOST = 'root@49.13.197.250'
export const REMOTE_DIR = '/opt/xmartmenu/persistent-import'
export const SSH_OPTIONS = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10']
export const PLAN = `PLAN ONLY: no source, SSH, Docker, filesystem or database operation.
Persistent database xmartmenu in existing PG17 candidate e12scyfsrp822dag7m9wwd4x on skaleclub-mail.
No new PG container, published port, Xmail DB write, production app/env change or deployment.
Fresh host/cgroup/connection admission; new database and own NOLOGIN roles must be absent.
Source exact project ktogbpqookfcqilqvici, verified TLS/exported READ ONLY RR snapshot.
Restore and compare47 full-row digests/6 authority groups/2 sequences/functions/ledger before COMMIT.
Encrypted archive+root-only recovery key retained in a NEW private durable backup bundle before COMMIT.
Existing authenticated/service_role never altered; missing service_role may be added NOLOGIN/NOBYPASSRLS.
A shared-cluster lease and per-target transaction lock prevent parallel imports. Partial state is preserved on failure.
Target-only UUID/FK scaffold is NOT migrated login; runtime roles remain NOLOGIN.
ICU153.121 to153.136/en-US/rulesNULL requires --allow-reviewed-icu-upgrade explicitly; never inferred.
All collatable current values must preserve native ordering/equality/casefold hashes before COMMIT.
No off-host/R2/scheduling/PITR/network proof or cutover is claimed.
Execute only after exact review and private static-code transfer; no reset/retry of a populated target.
`
const CODE_FILES = ['import-xprout-private-candidate.sh','import-xprout-private-candidate.helper.mjs','xprout-archive-crypto.mjs','xprout-source-protocol.mjs']
export function sshEnvironment(env = process.env) {
  const allowed = new Set(['PATH','HOME','USERPROFILE','HOMEDRIVE','HOMEPATH','SYSTEMROOT','WINDIR','PROGRAMDATA','TEMP','TMP','SSH_AUTH_SOCK','SSH_AGENT_PID','LANG','LC_ALL'].map(key => key.toLowerCase()))
  return Object.fromEntries(Object.entries(env).filter(([key, value]) => allowed.has(key.toLowerCase()) && typeof value === 'string'))
}
async function verifyRemoteCode() {
  const expected = await Promise.all(CODE_FILES.map(async name => [name, sha256(await readFile(new URL(name, import.meta.url)))]))
  const response = spawnSync('ssh', [...SSH_OPTIONS, SSH_HOST, 'sha256sum', ...CODE_FILES.map(name => `${REMOTE_DIR}/${name}`)], { encoding: 'utf8', env: sshEnvironment(), windowsHide: true, timeout: 20000, maxBuffer: 8192 })
  if (response.status !== 0) throw Error('Remote code refused')
  const lines = response.stdout.trim().split('\n')
  if (lines.length !== expected.length || expected.some(([name, digest], index) => lines[index] !== `${digest}  ${REMOTE_DIR}/${name}`)) throw Error('Remote code refused')
}
async function sourceAdmission(client) {
  const { rows: [state] } = await client.query(`SELECT current_setting('transaction_read_only') AS ro,pg_database_size(current_database())::text AS bytes,
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')) AS tables`)
  if (state.ro !== 'on' || state.tables !== 47 || BigInt(state.bytes) > 67108864n) throw Error('Source admission refused')
  const { rows: [visibility] } = await client.query(`SELECT count(*) FILTER(WHERE has_table_privilege(c.oid,'SELECT'))::int AS readable,
    count(*) FILTER(WHERE c.relrowsecurity AND NOT(r.rolsuper OR r.rolbypassrls OR (NOT c.relforcerowsecurity AND pg_has_role(current_user,c.relowner,'USAGE'))))::int AS filtered
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.rolname=current_user WHERE n.nspname='public' AND c.relkind IN ('r','p')`)
  if (visibility.readable !== 47 || visibility.filtered !== 0) throw Error('Source visibility refused')
  const { rows: foreignKeys } = await client.query(`SELECT child.relname AS child,parent.relname AS parent,pn.nspname AS schema,c.confdeltype AS action,c.convalidated AS validated,
    cardinality(c.conkey) AS columns,ca.attname AS column,pa.attname AS referenced
    FROM pg_constraint c JOIN pg_class child ON child.oid=c.conrelid JOIN pg_namespace cn ON cn.oid=child.relnamespace
    JOIN pg_class parent ON parent.oid=c.confrelid JOIN pg_namespace pn ON pn.oid=parent.relnamespace
    JOIN pg_attribute ca ON ca.attrelid=child.oid AND ca.attnum=c.conkey[1] JOIN pg_attribute pa ON pa.attrelid=parent.oid AND pa.attnum=c.confkey[1]
    WHERE c.contype='f' AND cn.nspname IN ('public','supabase_migrations') AND pn.nspname NOT IN ('public','supabase_migrations') ORDER BY child.relname`)
  const expected = [{ child: 'customer_profiles', column: 'id', action: 'c' }, { child: 'orders', column: 'customer_id', action: 'n' }, { child: 'profiles', column: 'id', action: 'c' }, { child: 'waiter_calls', column: 'acknowledged_by', action: 'n' }].map(row => ({ ...row, parent: 'users', schema: 'auth', validated: true, columns: 1, referenced: 'id' }))
  if (JSON.stringify(canonical(foreignKeys)) !== JSON.stringify(canonical(expected))) throw Error('Source dependencies refused')
  const { rows: roles } = await client.query("SELECT DISTINCT unnest(roles)::text AS role FROM pg_policies WHERE schemaname='public' ORDER BY role")
  if (roles.map(row => row.role).join('|') !== 'authenticated|public|service_role') throw Error('Source policy roles refused')
  const { rows: functions } = await client.query("SELECT pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'")
  if (functions.length !== 21 || functions.some(({ definition }) => /\b(?:https?):\/\/|\b(net|vault|storage|extensions|realtime|pgsodium)\s*\.|http_post|http_get/i.test(definition)
    || [...definition.matchAll(/\bauth\s*\.\s*([a-z_][a-z0-9_]*)/gi)].some(match => !['uid','role'].includes(match[1].toLowerCase())))) throw Error('Source function dependencies refused')
}
export async function executeImport(envPath,allowReviewedIcuUpgrade=false) {
  let client, child, sourceOpen = false, sourceTimer, overallTimer
  const abort = () => { child?.kill('SIGTERM'); if (child) setTimeout(() => child.kill('SIGKILL'), 5000).unref(); void client?.end().catch(() => {}) }
  process.once('SIGINT', abort); process.once('SIGTERM', abort); process.once('SIGHUP', abort)
  try {
    await verifyRemoteCode()
    const [{ default: dotenv }, { default: pg }] = await Promise.all([import('dotenv'), import('pg')])
    const env = dotenv.parse(await readFile(envPath, 'utf8'))
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw Error('TLS override refused')
    const config = sourceConfig(env)
    const response = await fetch(SOURCE_CA_URL, { redirect: 'error', signal: AbortSignal.timeout(8000) })
    if (!response.ok) throw Error('Source CA unavailable')
    const ca = publicCa(await response.text())
    client = new pg.Client({ connectionString: config.url, ssl: { ca, rejectUnauthorized: true, servername: new URL(config.url).hostname }, connectionTimeoutMillis: 8000, statement_timeout: 30000, query_timeout: 35000, application_name: 'xmartmenu-import-snapshot-holder' })
    await client.connect()
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); sourceOpen = true
    sourceTimer = setTimeout(abort, 180000)
    await client.query("SET LOCAL search_path=pg_catalog,public; SET LOCAL lock_timeout='500ms'; SET LOCAL idle_in_transaction_session_timeout='205000ms'; SET LOCAL timezone='UTC'; SET LOCAL datestyle='ISO, YMD'; SET LOCAL extra_float_digits=3; SET LOCAL bytea_output='hex'")
    await sourceAdmission(client)
    const { rows: [snapshot] } = await client.query('SELECT pg_export_snapshot() AS id')
    const manifest = assertManifest((await client.query(MANIFEST_SQL)).rows[0]?.manifest)
    const authIds = (await client.query('SELECT id::text FROM auth.users ORDER BY id')).rows.map(row => row.id)
    const packet = assertPacket({ ca, environment: config.environment, snapshot: snapshot.id, manifest, authIds })
    const { rows:[locale] } = await client.query("SELECT pg_encoding_to_char(encoding) AS encoding,datlocprovider AS provider,datcollate AS collate,datctype AS ctype,coalesce(to_jsonb(d)->>'datlocale',to_jsonb(d)->>'daticulocale') AS locale,to_jsonb(d)->>'daticurules' AS \"icuRules\",datcollversion AS version,pg_database_collation_actual_version(oid) AS \"actualVersion\" FROM pg_database d WHERE datname=current_database()")
    localeSql(locale,allowReviewedIcuUpgrade)
    const { rows:[{columns}] } = await client.query(TEXT_COLUMNS_SQL)
    const semantics = (await client.query(textSemanticsSql(columns))).rows[0].text_semantics
    assertTextSemantics(semantics,semantics)
    child = spawn('ssh', [...SSH_OPTIONS, SSH_HOST, 'bash', `${REMOTE_DIR}/import-xprout-private-candidate.sh`, '--execute-reviewed-import'], { stdio: ['pipe', 'pipe', 'pipe'], env: sshEnvironment(), windowsHide: true })
    child.stderr.resume(); child.stdin.on('error', () => {})
    const completed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => resolve(code)) })
    overallTimer = setTimeout(abort, 420000)
    child.stdin.write(`${JSON.stringify({packet,locale,allowReviewedIcuUpgrade,columns,semantics})}\n`)
    let report, released = false
    for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
      if (line.length > 16384) throw Error('Remote protocol refused')
      if (line === 'SNAPSHOT_DUMP_COMPLETE' && !released) {
        await client.query('ROLLBACK'); sourceOpen = false; await client.end(); client = undefined
        clearTimeout(sourceTimer); released = true
        child.stdin.end('SOURCE_RELEASED\n')
      } else if (line.startsWith('{') && released && !report) {
        const candidate = JSON.parse(line), expectedReport = persistentReport(manifest,manifest,{icuUpgradeReviewed:allowReviewedIcuUpgrade,collatableColumns:columns.length})
        if (JSON.stringify(canonical(candidate)) !== JSON.stringify(canonical(expectedReport))) throw Error('Remote proof refused')
        report = candidate
      } else throw Error('Remote protocol refused')
    }
    if (await completed !== 0 || !report || !released) throw Error('Persistent import incomplete')
    return report
  } finally {
    process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort); process.removeListener('SIGHUP', abort)
    clearTimeout(sourceTimer); clearTimeout(overallTimer)
    if (child && child.exitCode === null) child.kill('SIGTERM')
    if (client) { if (sourceOpen) await client.query('ROLLBACK').catch(() => {}); await client.end().catch(() => {}) }
  }
}
async function main(args) {
  if (!args.length || (args.length === 1 && args[0] === '--plan')) { process.stdout.write(PLAN); return }
  const explicit=args.length===4&&args[3]==='--allow-reviewed-icu-upgrade'
  if ((!explicit&&args.length!==3)||args[0]!=='--execute-reviewed-import'||args[1]!=='--source-env'||!args[2]||/[\r\n\0]/.test(args[2])) { process.stderr.write('Refused: use --plan or the reviewed explicit source-env/ICU execution.\n');process.exitCode=2;return }
  try { process.stdout.write(`${JSON.stringify(await executeImport(args[2],explicit))}\n`) }
  catch { process.stderr.write('Xprout persistent import failed; success withheld and partial target/backups preserved. Private details omitted.\n'); process.exitCode = 1 }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main(process.argv.slice(2))
