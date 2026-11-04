// Metadata/counts only. An explicit source probe; never a migration or dump.
import dotenv from 'dotenv'
import pg from 'pg'
import { SOURCE_SUPABASE_PROJECT } from './lib/database-target.mjs'

dotenv.config({ path: ['.env.local', '.env'], quiet: true })
if (!process.argv.includes('--source-read-only')) throw new Error('Requires --source-read-only')
const url = new URL(process.env.DATABASE_URL)
const ref = process.env.SUPABASE_PROJECT_REF
if (ref !== SOURCE_SUPABASE_PROJECT || !(url.hostname === `db.${ref}.supabase.co` ||
  (/\.pooler\.supabase\.com$/.test(url.hostname) && decodeURIComponent(url.username) === `postgres.${ref}`))) {
  throw new Error('Source configuration does not match the inventoried production project')
}
const client = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 10_000, statement_timeout: 15_000 })
try {
  await client.connect()
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  const report = { measuredAt: new Date().toISOString(), sourceProject: ref, tables: [] }
  const queries = {
    database: "SELECT current_setting('server_version') AS version,pg_database_size(current_database())::text AS bytes",
    roles: 'SELECT role,count(*)::int FROM public.profiles GROUP BY role ORDER BY role',
    identities: 'SELECT provider,count(*)::int FROM auth.identities GROUP BY provider ORDER BY provider',
    accounts: `SELECT count(*)::int AS total,count(*) FILTER(WHERE phone_confirmed_at IS NOT NULL)::int AS verified_phone,
      count(*) FILTER(WHERE email_confirmed_at IS NOT NULL)::int AS verified_email,
      count(*) FILTER(WHERE banned_until>now())::int AS banned FROM auth.users`,
    accountIntegrity: `SELECT
      (SELECT count(*)::int FROM public.profiles p LEFT JOIN auth.users u ON u.id=p.id WHERE u.id IS NULL) AS orphan_profiles,
      (SELECT count(*)::int FROM auth.users u LEFT JOIN public.profiles p ON p.id=u.id WHERE p.id IS NULL) AS users_without_profile`,
    buckets: 'SELECT id,public FROM storage.buckets ORDER BY id',
    objects: `SELECT bucket_id,count(*)::int AS objects,sum(coalesce((metadata->>'size')::bigint,0))::text AS bytes FROM storage.objects GROUP BY bucket_id`,
    extensions: 'SELECT extname,extversion FROM pg_extension ORDER BY extname',
    functions: "SELECT p.proname,p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY p.proname",
    policies: "SELECT tablename,count(*)::int FROM pg_policies WHERE schemaname='public' GROUP BY tablename ORDER BY tablename",
    migrations: 'SELECT count(*)::int AS applied,max(version) AS latest FROM supabase_migrations.schema_migrations',
    authForeignKeys: `SELECT c.conrelid::regclass::text AS source,c.conname,c.confrelid::regclass::text AS target
      FROM pg_constraint c JOIN pg_class t ON t.oid=c.confrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE c.contype='f' AND n.nspname='auth' ORDER BY 1,2`,
  }
  for (const [name, sql] of Object.entries(queries)) report[name] = (await client.query(sql)).rows
  const tables = (await client.query(`SELECT c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname`)).rows
  for (const table of tables) {
    const quoted = '"' + table.relname.replaceAll('"', '""') + '"'
    const { rows } = await client.query(`SELECT count(*)::int AS rows FROM public.${quoted}`)
    report.tables.push({ name: table.relname, rls: table.relrowsecurity, rows: rows[0].rows })
  }
  await client.query('ROLLBACK')
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  console.error(`Read-only inventory failed (${error.code ?? 'connection/query error'}); no credentials logged`)
  process.exitCode = 1
} finally { await client.end() }
