import { createHash, X509Certificate } from 'node:crypto'

export const SOURCE_PROJECT = 'ktogbpqookfcqilqvici'
export const SOURCE_CA_URL = 'https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt'
export const SOURCE_CA_SHA256 = '807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA'
export const TABLES = ['ai_generation_logs','ai_jobs','ai_usage','ai_usage_events','audit_events','blog_generation_jobs','blog_post_feedback','blog_posts','blog_rss_items','blog_rss_sources','blog_settings','categories','chat_addon_settings','chat_blocked_phones','chat_conversations','chat_messages','customer_profiles','delivery_zones','ingredients','launch_checklist_items','locations','menu_events','menu_sessions','menus','order_items','orders','payment_divergences','plans','platform_ai_settings','platform_settings','processed_stripe_events','product_ingredients','product_media','product_option_groups','product_options','products','profiles','qr_codes','restaurant_tables','scan_events','stripe_connections','telegram_settings','tenant_ai_settings','tenant_settings','tenant_subscriptions','tenants','waiter_calls']
const ID_GROUPS = ['auth_ids','order_items','orders','product_tenants','profile_authority','tenants']
export const SEQUENCES = { ai_usage_events_id_seq: 'ai_usage_events', audit_events_id_seq: 'audit_events' }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HEX = /^[a-f0-9]{64}$/
export const canonical = value => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  : Array.isArray(value) ? value.map(canonical) : value
export function publicCa(ca) {
  if (typeof ca !== 'string' || ca.length > 32768) throw Error('Source CA refused')
  const cert = new X509Certificate(ca)
  if (!cert.ca || cert.fingerprint256.replaceAll(':', '') !== SOURCE_CA_SHA256 || Date.parse(cert.validFrom) > Date.now() || Date.parse(cert.validTo) <= Date.now()) throw Error('Source CA refused')
  return ca
}
export function sourceConfig(env) {
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw Error('Source configuration refused')
  const u = new URL(env.DATABASE_URL || ''), api = new URL(env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || '')
  const user = decodeURIComponent(u.username)
  const direct = u.hostname === `db.${SOURCE_PROJECT}.supabase.co` && user === 'postgres'
  const pooler = /^aws-[0-9]+-[a-z0-9-]+[.]pooler[.]supabase[.]com$/.test(u.hostname) && user === `postgres.${SOURCE_PROJECT}`
  if (env.SUPABASE_PROJECT_REF !== SOURCE_PROJECT || api.protocol !== 'https:' || api.hostname !== `${SOURCE_PROJECT}.supabase.co` || api.port || api.username || api.password || api.hash || api.search || !['', '/'].includes(api.pathname)
    || !['postgres:', 'postgresql:'].includes(u.protocol) || !(direct || pooler) || u.pathname !== '/postgres' || !['5432', '6543'].includes(u.port) || u.hash || !u.password) throw Error('Source configuration refused')
  for (const [key, value] of u.searchParams) if (!['sslmode', 'application_name'].includes(key) || u.searchParams.getAll(key).length !== 1 || (key === 'sslmode' && !['require', 'verify-ca', 'verify-full'].includes(value))) throw Error('Source configuration refused')
  u.port = '5432'; u.search = ''; u.hash = ''
  const pg = { PGHOST: u.hostname, PGPORT: '5432', PGDATABASE: 'postgres', PGUSER: user, PGPASSWORD: decodeURIComponent(u.password), PGSSLMODE: 'verify-full', PGSSLROOTCERT: '/private/source-ca.crt', PGCONNECT_TIMEOUT: '8', PGAPPNAME: 'xmartmenu-readonly-rehearsal', PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=120000 -c lock_timeout=2000' }
  if (Object.values(pg).some(value => /[\r\n\0]/.test(value))) throw Error('Source configuration refused')
  return { url: u.href, environment: Object.entries(pg).map(([key, value]) => `${key}=${value}`).join('\n') }
}

// One canonical query executes in the same exported source snapshot as pg_dump,
// and in the isolated target. Full row digests remain private host artifacts.
export const MANIFEST_SQL = `WITH relations AS MATERIALIZED (
 SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')
), table_counts AS MATERIALIZED (
 SELECT relname,((xpath('/row/n/text()',query_to_xml(format('SELECT count(*) AS n FROM public.%I',relname),false,true,'')))[1]::text)::bigint AS n FROM relations
), table_digests AS MATERIALIZED (
 SELECT relname,(xpath('/row/value/text()',query_to_xml(format($row_digest$SELECT encode(pg_catalog.sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha COLLATE "C"),''),'UTF8')),'hex') AS value FROM (SELECT encode(pg_catalog.sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM public.%I t) source_rows$row_digest$,relname),false,true,'')))[1]::text AS value FROM relations
), sequence_definitions AS MATERIALIZED (
 SELECT c.relname,s.*,d.deptype AS ownership,tn.nspname AS table_schema,t.relname AS owned_table,a.attname AS owned_column,
  query_to_xml(format('SELECT last_value::text AS last_value,is_called FROM public.%I',c.relname),false,true,'') AS state
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_sequence s ON s.seqrelid=c.oid
 LEFT JOIN pg_depend d ON d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype IN ('a','i')
 LEFT JOIN pg_class t ON t.oid=d.refobjid LEFT JOIN pg_namespace tn ON tn.oid=t.relnamespace
 LEFT JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=d.refobjsubid WHERE n.nspname='public' AND c.relkind='S'
), critical_input AS (
 SELECT 'auth_ids'::text AS name,id::text AS key,jsonb_build_object('id',id)::text AS payload FROM auth.users
 UNION ALL SELECT 'profile_authority',id::text,jsonb_build_object('id',id,'tenant_id',tenant_id,'role',role)::text FROM public.profiles
 UNION ALL SELECT 'tenants',id::text,jsonb_build_object('id',id)::text FROM public.tenants
 UNION ALL SELECT 'product_tenants',id::text,jsonb_build_object('id',id,'tenant_id',tenant_id,'menu_id',menu_id)::text FROM public.products
 UNION ALL SELECT 'orders',id::text,jsonb_build_object('id',id,'tenant_id',tenant_id,'customer_id',customer_id,'currency',currency,'total',total)::text FROM public.orders
 UNION ALL SELECT 'order_items',id::text,jsonb_build_object('id',id,'order_id',order_id,'product_id',product_id)::text FROM public.order_items
), critical_rows AS (
 SELECT name,key,encode(pg_catalog.sha256(convert_to(payload,'UTF8')),'hex') AS row_sha FROM critical_input
), critical_groups AS (
 SELECT names.name,encode(pg_catalog.sha256(convert_to(coalesce(string_agg(d.row_sha,'' ORDER BY d.key COLLATE "C"),''),'UTF8')),'hex') AS value
 FROM (VALUES ('auth_ids'),('profile_authority'),('tenants'),('product_tenants'),('orders'),('order_items')) names(name)
 LEFT JOIN critical_rows d ON d.name=names.name GROUP BY names.name
), totals AS (
 SELECT status,currency,count(*)::int AS count,sum(total)::text AS total FROM public.orders GROUP BY status,currency
), function_rows AS (
 SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS args,encode(pg_catalog.sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') AS value
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
)
SELECT jsonb_build_object('version',1,'publicTableCount',(SELECT count(*) FROM table_counts),
 'counts',(SELECT jsonb_object_agg(relname,n) FROM table_counts),'digests',(SELECT jsonb_object_agg(relname,value) FROM table_digests),
 'criticalDigests',(SELECT jsonb_object_agg(name,value) FROM critical_groups),
 'functionDigest',(SELECT encode(pg_catalog.sha256(convert_to(coalesce(string_agg(value,'' ORDER BY proname COLLATE "C",args COLLATE "C"),''),'UTF8')),'hex') FROM function_rows),
 'authIdCount',(SELECT count(*) FROM auth.users),'orphanProfiles',(SELECT count(*) FROM public.profiles p LEFT JOIN auth.users u ON u.id=p.id WHERE u.id IS NULL),
 'authWithoutProfile',(SELECT count(*) FROM auth.users u LEFT JOIN public.profiles p ON p.id=u.id WHERE p.id IS NULL),
 'roles',(SELECT jsonb_object_agg(role,n) FROM (SELECT role,count(*) AS n FROM public.profiles GROUP BY role) r),
 'orderTotals',(SELECT jsonb_agg(to_jsonb(t) ORDER BY status,currency NULLS FIRST) FROM totals t),
 'sequenceCount',(SELECT count(*) FROM sequence_definitions),
 'sequences',(SELECT jsonb_object_agg(relname,jsonb_build_object('type',format_type(seqtypid,NULL),'start',seqstart::text,'increment',seqincrement::text,'minimum',seqmin::text,'maximum',seqmax::text,'cache',seqcache::text,'cycle',seqcycle,
   'ownership',ownership,'tableSchema',table_schema,'table',owned_table,'column',owned_column,'lastValue',(xpath('/row/last_value/text()',state))[1]::text,'isCalled',((xpath('/row/is_called/text()',state))[1]::text)::boolean)) FROM sequence_definitions),
 'ledgerCount',(SELECT count(*) FROM supabase_migrations.schema_migrations),'ledgerLatest',(SELECT max(version) FROM supabase_migrations.schema_migrations),
 'ledgerDigest',(SELECT encode(pg_catalog.sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY version COLLATE "C"),''),'UTF8')),'hex') FROM supabase_migrations.schema_migrations t)) AS manifest`

export function assertManifest(manifest) {
  const fields = ['version','publicTableCount','counts','digests','criticalDigests','functionDigest','authIdCount','orphanProfiles','authWithoutProfile','roles','orderTotals','sequenceCount','sequences','ledgerCount','ledgerLatest','ledgerDigest'].sort()
  if (!manifest || Object.keys(manifest).sort().join('|') !== fields.join('|') || manifest.version !== 1 || manifest.publicTableCount !== 47 || manifest.authIdCount !== 7 || manifest.orphanProfiles !== 0 || manifest.authWithoutProfile !== 0 || manifest.sequenceCount !== 2 || manifest.ledgerCount !== 92 || manifest.ledgerLatest !== '20261027097000') throw Error('Manifest baseline refused')
  if (!manifest.sequences || Object.keys(manifest.sequences).sort().join('|') !== Object.keys(SEQUENCES).join('|')) throw Error('Sequence baseline refused')
  for (const [name, table] of Object.entries(SEQUENCES)) {
    const sequence = manifest.sequences[name]
    const expected = { type:'bigint',start:'1',increment:'1',minimum:'1',maximum:'9223372036854775807',cache:'1',cycle:false,ownership:'a',tableSchema:'public',table,column:'id',lastValue:sequence?.lastValue,isCalled:sequence?.isCalled }
    if (!sequence || typeof sequence.lastValue !== 'string' || !/^[1-9][0-9]*$/.test(sequence.lastValue) || BigInt(sequence.lastValue) > 9223372036854775807n || typeof sequence.isCalled !== 'boolean' || JSON.stringify(canonical(sequence)) !== JSON.stringify(canonical(expected))) throw Error('Sequence baseline refused')
  }
  if (!manifest.counts || Object.keys(manifest.counts).sort().join('|') !== TABLES.join('|') || !Object.values(manifest.counts).every(value => Number.isSafeInteger(value) && value >= 0)
    || manifest.counts.profiles !== 7 || manifest.counts.tenants !== 3 || manifest.counts.products !== 56 || manifest.counts.orders !== 2 || manifest.counts.order_items !== 6) throw Error('Manifest baseline refused')
  if (!manifest.digests || Object.keys(manifest.digests).sort().join('|') !== TABLES.join('|') || !Object.values(manifest.digests).every(value => typeof value === 'string' && HEX.test(value))
    || !manifest.criticalDigests || Object.keys(manifest.criticalDigests).sort().join('|') !== ID_GROUPS.join('|') || !Object.values(manifest.criticalDigests).every(value => typeof value === 'string' && HEX.test(value)) || !HEX.test(manifest.functionDigest) || !HEX.test(manifest.ledgerDigest)) throw Error('Manifest digest refused')
  if (JSON.stringify(canonical(manifest.roles)) !== JSON.stringify(canonical({ superadmin: 1, 'store-admin': 3, customer: 3 })) || JSON.stringify(canonical(manifest.orderTotals)) !== JSON.stringify(canonical([{ count: 1, total: '247.90', status: 'cancelled', currency: null }, { count: 1, total: '77.90', status: 'pending', currency: null }]))) throw Error('Manifest authority or totals refused')
  return manifest
}
export function compareManifests(source, target) {
  assertManifest(source); assertManifest(target)
  if (JSON.stringify(canonical(source)) !== JSON.stringify(canonical(target))) throw Error('Snapshot reconciliation refused')
  return { rehearsal: 'passed', sourceProject: SOURCE_PROJECT, publicTableCountsMatched: 47, fullPublicRowDigestsMatched: 47, criticalIdGroupsMatched: 6, sequenceDefinitionsMatched:2,sequenceStatesMatched:2,sequenceSnapshotGuarantee:'not_mvcc_requires_final_writer_freeze',profiles: 7, tenants: 3, products: 56, orders: 2, orderItems: 6, originalUuidRelations: 'matched', roleDistribution: 'matched', nullableOrderTotals: 'matched', functionBodies: 'matched', ledgerRecords: 92, sourceSnapshot: 'exported_repeatable_read', sourceReadOnly: true, authStub: 'non_authenticating_uuid_fk_compatibility_only', loginMigrated: false, applicationCutover: false, temporaryResourcesRemoved: true }
}
export function assertPacket(packet) {
  if (!packet || Object.keys(packet).sort().join('|') !== ['authIds','ca','environment','manifest','snapshot'].sort().join('|') || JSON.stringify(packet).length > 131072) throw Error('Source packet refused')
  publicCa(packet.ca); assertManifest(packet.manifest)
  if (!/^[a-f0-9]{8}-[a-f0-9]{8}-[0-9]+$/i.test(packet.snapshot) || !Array.isArray(packet.authIds) || packet.authIds.length !== 7 || new Set(packet.authIds).size !== 7 || !packet.authIds.every(id => typeof id === 'string' && UUID.test(id))) throw Error('Source packet refused')
  if (typeof packet.environment !== 'string' || packet.environment.length > 8192 || packet.environment.includes('\0')) throw Error('Source packet refused')
  const environment = Object.fromEntries(packet.environment.split('\n').map(line => { const index = line.indexOf('='); if (index < 1 || line.includes('\r')) throw Error(); return [line.slice(0,index),line.slice(index+1)] }))
  const host = environment.PGHOST, user = environment.PGUSER
  const direct = host === `db.${SOURCE_PROJECT}.supabase.co` && user === 'postgres'
  const pooler = /^aws-[0-9]+-[a-z0-9-]+[.]pooler[.]supabase[.]com$/.test(host || '') && user === `postgres.${SOURCE_PROJECT}`
  const expected = { PGHOST: host, PGPORT: '5432', PGDATABASE: 'postgres', PGUSER: user, PGPASSWORD: environment.PGPASSWORD, PGSSLMODE: 'verify-full', PGSSLROOTCERT: '/private/source-ca.crt', PGCONNECT_TIMEOUT: '8', PGAPPNAME: 'xmartmenu-readonly-rehearsal', PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=120000 -c lock_timeout=2000' }
  if (!(direct || pooler) || !environment.PGPASSWORD || JSON.stringify(canonical(environment)) !== JSON.stringify(canonical(expected)) || packet.environment.split('\n').length !== Object.keys(expected).length) throw Error('Source packet refused')
  return packet
}
export function compatibilitySql(authIds) {
  if (!Array.isArray(authIds) || authIds.length !== 7 || new Set(authIds).size !== 7 || !authIds.every(id => UUID.test(id))) throw Error('Compatibility UUIDs refused')
  return `CREATE ROLE authenticated NOLOGIN NOBYPASSRLS; CREATE ROLE service_role NOLOGIN NOBYPASSRLS;
CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT NULL::uuid';
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS 'SELECT NULL::text';
REVOKE ALL ON SCHEMA auth FROM PUBLIC; REVOKE ALL ON ALL TABLES IN SCHEMA auth FROM PUBLIC; REVOKE ALL ON ALL FUNCTIONS IN SCHEMA auth FROM PUBLIC;
INSERT INTO auth.users(id) VALUES ${authIds.map(id => `('${id}')`).join(',')};`
}
export const sha256 = value => createHash('sha256').update(value).digest('hex')
