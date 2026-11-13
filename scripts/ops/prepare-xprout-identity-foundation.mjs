import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { assertManifest, canonical, MANIFEST_SQL, publicCa, sha256, sourceConfig, SOURCE_CA_URL, SOURCE_PROJECT, TABLES } from './xprout-source-protocol.mjs'

// Preparation module only. Applying its private SQL needs a separately reviewed
// host runner, fresh authenticated backup/restore and actual disabled-image pins.
export const MIGRATIONS = [
  ['20261103190000', 'application_identity', '9f0e4a498409c7c9d08752f1841384deafd9bc24008bbfcb950a6a972a7ada25'],
  ['20261103200000', 'identity_session_provenance', '9f05416e0a01fbd8d952804d13a7e288013611274779ede9d4090da078912480'],
  ['20261103210000', 'identity_browser_challenges', 'afc546ea90481d093c96bccfc785e600a21b72bae2565c23945b5d54373142d0'],
  ['20261104090000', 'identity_google_claims', '40273e642ef063992c86df90cb0977ef1841791c2176e7171c11aa699a9cd1c0'],
]
export const IDENTITY_TABLES = ['app_accounts', 'app_identity_bindings', 'app_sessions', 'app_identity_challenges', 'identity_google_subject_claims']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const HEX = /^[0-9a-f]{64}$/
const literal = value => `'${String(value).replaceAll("'", "''")}'`
/** @typedef {{version:number,sourceProject:string,capturedAt:string,profilesDigest:string,authorityDigest:string,authIdsDigest:string,users:Array<{id:string,disabled:boolean}>,readOnlySnapshot:boolean}} IdentityReview */
export const PLAN = 'PLAN ONLY: no source/SSH/SQL/filesystem mutation. Prepare three pinned additive migrations and optional exact-seven UUID/ban/reset bootstrap; no bindings, sessions, roles, runtime login, flags or provider calls. Application requires a separately reviewed backup/restore and host runner.\n'
// Public prelude must execute BEFORE sending a private libpq batch. A psql
// stdin caller executes these statements before parsing later private SQL.
export const FOUNDATION_PRELUDE = `BEGIN;
SET LOCAL log_statement='none'; SET LOCAL log_duration=off;
SET LOCAL log_min_duration_statement=-1; SET LOCAL log_min_duration_sample=-1;
SET LOCAL log_statement_sample_rate=0; SET LOCAL log_min_error_statement='panic';
SET LOCAL log_min_messages='panic'; SET LOCAL log_parameter_max_length=0;
SET LOCAL log_parameter_max_length_on_error=0; SET LOCAL pg_stat_statements.track='none';
DO $guard$ BEGIN
 IF EXISTS(SELECT FROM regexp_split_to_table(current_setting('shared_preload_libraries'),',') AS item
   WHERE trim(both ' "' from item) NOT IN ('','pg_stat_statements'))
 OR current_setting('session_preload_libraries')<>'' OR current_setting('local_preload_libraries')<>''
 THEN RAISE EXCEPTION 'Unreviewed identity SQL audit module'; END IF;
END $guard$;
CREATE TEMP TABLE identity_foundation_prepared(marker boolean NOT NULL) ON COMMIT DROP;
INSERT INTO identity_foundation_prepared VALUES(true);
`

export function validateReview(value, manifest, now = Date.now()) {
  assertManifest(manifest)
  const fields = ['version', 'sourceProject', 'capturedAt', 'profilesDigest', 'authorityDigest', 'authIdsDigest', 'users', 'readOnlySnapshot']
  if (!value || Object.keys(value).sort().join() !== fields.sort().join() || value.version !== 1
    || value.sourceProject !== SOURCE_PROJECT || value.readOnlySnapshot !== true
    || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/.test(value.capturedAt)
    || !Number.isFinite(Date.parse(value.capturedAt)) || now-Date.parse(value.capturedAt) < -5000 || now-Date.parse(value.capturedAt) > 300000
    || !HEX.test(value.profilesDigest) || value.profilesDigest !== manifest.digests.profiles
    || value.authorityDigest !== manifest.criticalDigests.profile_authority || value.authIdsDigest !== manifest.criticalDigests.auth_ids
    || !Array.isArray(value.users) || value.users.length !== 7) throw Error('Exact fresh identity review refused')
  const seen = new Set()
  for (const row of value.users) {
    if (!row || Object.keys(row).sort().join() !== 'disabled,id' || !UUID.test(row.id) || typeof row.disabled !== 'boolean' || seen.has(row.id)) throw Error('Exact fresh identity review refused')
    seen.add(row.id)
  }
  return value
}

// Unlike the imported auth.users(id) scaffold, this source snapshot observes
// current bans/deletions. Never select password hashes, emails or phone numbers.
export const CONTROL_SQL = `SELECT p.id::text AS id,a.id IS NOT NULL AS present,
  (coalesce(a.banned_until>transaction_timestamp(),false) OR a.deleted_at IS NOT NULL
   OR coalesce(p.must_change_password,false)) AS disabled
 FROM public.profiles p LEFT JOIN auth.users a ON a.id=p.id ORDER BY p.id LIMIT 8`

export const REVIEWED_ENGAGEMENT_TABLES = Object.freeze(['menu_events', 'menu_sessions', 'scan_events'])

/** Identity foundation only: never a final-refresh/cutover equivalence proof. */
export function identitySourceEvidence(source, candidate, allowReviewedEngagementDrift = false) {
  assertManifest(source); assertManifest(candidate)
  const compared = structuredClone(source)
  if (allowReviewedEngagementDrift === true) {
    for (const name of REVIEWED_ENGAGEMENT_TABLES) {
      compared.counts[name] = candidate.counts[name]
      compared.digests[name] = candidate.digests[name]
    }
  }
  if (JSON.stringify(canonical(compared)) !== JSON.stringify(canonical(candidate))) throw Error('Source and candidate require reconciliation')
  return {
    purpose: 'identity-foundation-only', reviewedEngagementDriftAllowed: allowReviewedEngagementDrift === true,
    sourceManifestSha256: sha256(JSON.stringify(canonical(source))), candidateManifestSha256: sha256(JSON.stringify(canonical(candidate))),
    tables: REVIEWED_ENGAGEMENT_TABLES.map(name => ({ name, candidateCount: candidate.counts[name], sourceCount: source.counts[name],
      candidateDigest: candidate.digests[name], sourceDigest: source.digests[name] })),
    allOtherTableDigestsMatched: 44, criticalGroupsMatched: 6, finalFullReconciliationRequired: true,
  }
}

export async function captureReview(envPath, manifest, dependencies = {}) {
  assertManifest(manifest)
  const allowEngagement = dependencies.allowReviewedEngagementDrift === true
  if (allowEngagement && typeof dependencies.recordSourceEvidence !== 'function') throw Error('Private reviewed engagement evidence sink required')
  const [{ default: dotenv }, { default: pg }] = await Promise.all([import('dotenv'), import('pg')])
  const env = dotenv.parse(await readFile(envPath, 'utf8'))
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw Error('Verified source TLS required')
  const config = sourceConfig(env)
  const request = dependencies.fetch ?? fetch
  const response = await request(SOURCE_CA_URL, { redirect: 'error', signal: AbortSignal.timeout(8000) })
  if (!response.ok) throw Error('Source CA unavailable')
  const ca = publicCa(await response.text())
  const client = dependencies.client ?? new pg.Client({ connectionString: config.url,
    ssl: { ca, rejectUnauthorized: true, servername: new URL(config.url).hostname },
    connectionTimeoutMillis: 8000, query_timeout: 12000, statement_timeout: 8000, application_name: 'xmartmenu-identity-source-review' })
  let open = false
  try {
    await client.connect()
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); open = true
    await client.query("SET LOCAL statement_timeout=8000; SET LOCAL lock_timeout=500; SET LOCAL idle_in_transaction_session_timeout=15000; SET LOCAL timezone='UTC'; SET LOCAL datestyle='ISO, YMD'; SET LOCAL extra_float_digits=3; SET LOCAL bytea_output='hex'")
    const { rows: [state] } = await client.query("SELECT current_setting('transaction_read_only') AS ro,date_trunc('second',transaction_timestamp()) AS captured,(SELECT count(*)::int FROM auth.users) AS users")
    const source = assertManifest((await client.query(MANIFEST_SQL)).rows[0]?.manifest)
    // Only the separately reviewed identity-preparation mode admits ongoing
    // engagement drift. Every other count/digest/authority/ledger/sequence field
    // stays exact; neither source nor candidate data is refreshed or modified.
    const evidence = identitySourceEvidence(source, manifest, allowEngagement)
    const { rows } = await client.query(CONTROL_SQL)
    if (state.ro !== 'on' || state.users !== 7 || rows.length !== 7 || rows.some(row => row.present !== true || typeof row.disabled !== 'boolean')) throw Error('Complete source identity controls required')
    const review = validateReview({ version: 1, sourceProject: SOURCE_PROJECT, capturedAt: state.captured.toISOString(),
      profilesDigest: source.digests.profiles, authorityDigest: source.criticalDigests.profile_authority,
      authIdsDigest: source.criticalDigests.auth_ids, users: rows.map(({ id, disabled }) => ({ id, disabled })), readOnlySnapshot: true }, manifest)
    await client.query('ROLLBACK'); open = false
    if (allowEngagement) await dependencies.recordSourceEvidence({ capturedAt: state.captured.toISOString(), ...evidence })
    return review // PRIVATE return value. Never log, persist or expose in CI.
  } finally {
    if (open) await client.query('ROLLBACK').catch(() => {})
    await client.end().catch(() => {})
  }
}

export async function migrationSources() {
  return Promise.all(MIGRATIONS.map(async ([version, name, expected]) => {
    const sql = (await readFile(new URL(`../../supabase/migrations/${version}_${name}.sql`, import.meta.url), 'utf8')).replaceAll('\r\n', '\n')
    if (sha256(sql) !== expected) throw Error('Reviewed identity migration changed')
    return { version, name, sql }
  }))
}

// Canonical Supabase migration files stay immutable. Native PostgreSQL need
// not have an anon role; revoke its new-table permissions only when it exists.
// Existing authenticated/service_role remain required; no role is created.
export function nativeIdentityMigrationSql({ version, sql }) {
  const known = MIGRATIONS.find(row => row[0] === version)
  if (!known || sha256(sql) !== known[2]) throw Error('Reviewed identity migration changed')
  const tables = version === '20261103190000'
    ? 'public.app_accounts, public.app_identity_bindings, public.app_sessions'
    : version === '20261103210000' ? 'public.app_identity_challenges' : null
  if (!tables) return sql
  const original = `REVOKE ALL ON ${tables} FROM PUBLIC, anon, authenticated;`
  if (sql.split(original).length !== 2) throw Error('Exact browser-role revoke required')
  return sql.replace(original, `REVOKE ALL ON ${tables} FROM PUBLIC, authenticated;
DO $optional_anon$ BEGIN
 IF to_regrole('anon') IS NOT NULL THEN EXECUTE 'REVOKE ALL ON ${tables} FROM anon'; END IF;
END $optional_anon$;`)
}

export function nativeIdentityProjection(sources) {
  if (!Array.isArray(sources) || sources.map(row => row.version).join() !== MIGRATIONS.map(row => row[0]).join()) throw Error('Exact identity projection required')
  const tables = IDENTITY_TABLES.map(name => `public.${name}`).join(', ')
  const sql = sources.map(nativeIdentityMigrationSql).join('\n') + `
GRANT SELECT,INSERT,UPDATE,DELETE ON ${tables} TO xmartmenu_runtime;
GRANT SELECT ON ${tables} TO xmartmenu_staging_reader;
`
  return { sql, sha256: sha256(sql), sourceMigrations: MIGRATIONS.map(([version, , hash]) => ({ version, sha256: hash })) }
}

// Preserve the original 47-table/92-ledger comparison after the additions.
// No other predicate or historical migration is silently changed.
export function preservedManifestSql() {
  let sql = MANIFEST_SQL.replace("WHERE n.nspname='public' AND c.relkind IN ('r','p')",
    `WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname NOT IN (${IDENTITY_TABLES.map(literal).join(',')})`)
  const versions = MIGRATIONS.map(([version]) => literal(version)).join(',')
  sql = sql.replaceAll('FROM supabase_migrations.schema_migrations)', `FROM supabase_migrations.schema_migrations WHERE version NOT IN (${versions}))`)
    .replace('FROM supabase_migrations.schema_migrations t)', `FROM supabase_migrations.schema_migrations t WHERE version NOT IN (${versions}))`)
  return sql
}

/** @param {ReturnType<typeof assertManifest>} manifest @param {IdentityReview|null} [review] @param {number} [now] */
export async function buildFoundationSql(manifest, review = null, now = Date.now()) {
  assertManifest(manifest)
  if (review) validateReview(review, manifest, now)
  const sources = await migrationSources()
  const projection = nativeIdentityProjection(sources)
  const baseline = literal(JSON.stringify(manifest))
  const newNames = IDENTITY_TABLES.map(literal).join(',')
  const roles = `SELECT jsonb_agg(to_jsonb(r)-'rolpassword' ORDER BY r.rolname) FROM pg_roles r`
  // Entire returned string is private when review is supplied. No stdout CLI.
  return `${FOUNDATION_PRELUDE}
DO $guard$ BEGIN
 IF to_regclass('pg_temp.identity_foundation_prepared') IS NULL
 THEN RAISE EXCEPTION 'Public identity prelude transaction required'; END IF;
END $guard$;
SET LOCAL statement_timeout=15000; SET LOCAL lock_timeout=2000;
SET LOCAL timezone='UTC'; SET LOCAL datestyle='ISO, YMD'; SET LOCAL extra_float_digits=3; SET LOCAL bytea_output='hex';
SELECT pg_advisory_xact_lock(hashtextextended('xmartmenu-identity-foundation-v1',0));
LOCK TABLE ${TABLES.map(name => `public.${name}`).join(',')} IN SHARE MODE;
LOCK TABLE auth.users,supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
DO $guard$ BEGIN
 IF current_database()<>'xmartmenu' OR current_user<>'xmail_owner' OR session_user<>'xmail_owner'
 OR NOT (SELECT rolsuper FROM pg_roles WHERE rolname=current_user)
 OR to_regrole('authenticated') IS NULL OR to_regrole('service_role') IS NULL
 OR (SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname=current_database())<>'xmartmenu_owner'
 OR EXISTS(SELECT FROM pg_tables WHERE schemaname='public' AND tablename IN (${newNames}))
 OR NOT EXISTS(SELECT FROM pg_authid WHERE rolname='xmartmenu_runtime' AND NOT rolcanlogin AND rolpassword IS NULL AND rolconnlimit=12)
 OR NOT EXISTS(SELECT FROM pg_authid WHERE rolname='xmartmenu_staging_reader' AND NOT rolcanlogin AND rolpassword IS NULL AND rolconnlimit=2)
 OR EXISTS(SELECT FROM pg_stat_activity WHERE usename IN ('xmartmenu_runtime','xmartmenu_staging_reader'))
 THEN RAISE EXCEPTION 'Identity foundation preflight refused'; END IF;
END $guard$;
CREATE TEMP TABLE identity_before ON COMMIT DROP AS ${MANIFEST_SQL};
CREATE TEMP TABLE identity_roles ON COMMIT DROP AS ${roles};
DO $guard$ BEGIN IF (SELECT manifest FROM identity_before)<>${baseline}::jsonb THEN RAISE EXCEPTION 'Candidate business baseline changed'; END IF; END $guard$;
SET LOCAL ROLE xmartmenu_owner;
${projection.sql}
RESET ROLE;
${sources.map(({ version, name, sql }) => `INSERT INTO supabase_migrations.schema_migrations(version,name,statements,created_by) VALUES(${literal(version)},${literal(name)},ARRAY[${literal(sql)}],${literal(`xmartmenu-native-projection-sha256:${projection.sha256}`)});`).join('\n')}
${review ? `CREATE TEMP TABLE identity_review ON COMMIT DROP AS SELECT ${literal(JSON.stringify(review))}::jsonb AS payload;
DO $guard$ BEGIN
 IF (SELECT (payload->>'capturedAt')::timestamptz FROM identity_review)<clock_timestamp()-interval '5 minutes'
 OR (SELECT (payload->>'capturedAt')::timestamptz FROM identity_review)>clock_timestamp()+interval '5 seconds'
 OR EXISTS(SELECT id FROM auth.users EXCEPT SELECT (r->>'id')::uuid FROM identity_review,jsonb_array_elements(payload->'users') r)
 OR EXISTS(SELECT (r->>'id')::uuid FROM identity_review,jsonb_array_elements(payload->'users') r EXCEPT SELECT id FROM auth.users)
 THEN RAISE EXCEPTION 'Fresh exact account controls required'; END IF;
END $guard$;
INSERT INTO public.app_accounts(id,disabled_at,session_version)
 SELECT (r->>'id')::uuid,CASE WHEN (r->>'disabled')::boolean THEN (payload->>'capturedAt')::timestamptz ELSE NULL END,0
 FROM identity_review,jsonb_array_elements(payload->'users') r;
` : ''}
CREATE TEMP TABLE identity_after ON COMMIT DROP AS ${preservedManifestSql()};
DO $guard$ BEGIN
 IF (SELECT manifest FROM identity_before) IS DISTINCT FROM (SELECT manifest FROM identity_after)
 OR (SELECT jsonb_agg FROM identity_roles) IS DISTINCT FROM (${roles})
 OR (SELECT count(*) FROM supabase_migrations.schema_migrations)<>96
 OR (SELECT count(*) FROM pg_tables WHERE schemaname='public')<>52
 OR (SELECT count(*) FROM public.app_accounts)<>${review ? 7 : 0}
 OR EXISTS(SELECT FROM public.app_identity_bindings) OR EXISTS(SELECT FROM public.app_sessions) OR EXISTS(SELECT FROM public.app_identity_challenges)
 OR EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname IN (${newNames}) AND
    (NOT c.relrowsecurity OR pg_get_userbyid(c.relowner)<>'xmartmenu_owner'
     OR coalesce(has_table_privilege(to_regrole('anon')::oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),false)
     OR has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
     OR NOT (has_table_privilege('xmartmenu_runtime',c.oid,'SELECT')
       AND has_table_privilege('xmartmenu_runtime',c.oid,'INSERT')
       AND has_table_privilege('xmartmenu_runtime',c.oid,'UPDATE')
       AND has_table_privilege('xmartmenu_runtime',c.oid,'DELETE'))
     OR NOT has_table_privilege('xmartmenu_staging_reader',c.oid,'SELECT')))
 THEN RAISE EXCEPTION 'Identity foundation proof refused'; END IF;
END $guard$;
COMMIT;
`
}

// Preferred API for a future programmatic executor: await the PUBLIC prelude
// before submitting privateSql. Never send the combined string as one libpq
// simple-query batch while connection logging is not yet disabled.
/** @param {ReturnType<typeof assertManifest>} manifest @param {IdentityReview|null} [review] @param {number} [now] */
export async function foundationTransaction(manifest, review = null, now = Date.now()) {
  const combined = await buildFoundationSql(manifest, review, now)
  return { publicPrelude: FOUNDATION_PRELUDE, privateSql: combined.slice(FOUNDATION_PRELUDE.length) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--plan')) process.stdout.write(PLAN)
  else { process.stderr.write('Preparation only; no direct source capture, SQL output or apply entrypoint.\n'); process.exitCode = 2 }
}
