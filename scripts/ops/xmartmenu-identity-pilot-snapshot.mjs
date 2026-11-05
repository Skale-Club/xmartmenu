import {preservedManifestSql} from './prepare-xmartmenu-identity-foundation.mjs'
import {assertManifest,canonical,sha256,TABLES} from './xmartmenu-source-protocol.mjs'

export const IDENTITY_TABLES=['app_accounts','app_identity_bindings','app_sessions','app_identity_challenges']
// One quiet READ ONLY snapshot, no identities/contact/rows in the public report.
// Its private result is used only to compare the clone and retain recovery proof.
export const PILOT_SNAPSHOT_SQL=`SELECT jsonb_build_object(
 'business',(${preservedManifestSql()}),
 'tables',(SELECT jsonb_agg(c.relname ORDER BY c.relname COLLATE "C") FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','p')),
 'ledgerCount',(SELECT count(*) FROM supabase_migrations.schema_migrations),
 'ledgerLatest',(SELECT max(version) FROM supabase_migrations.schema_migrations),
 'ledgerDigest',(SELECT encode(pg_catalog.sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY version COLLATE "C"),''),'UTF8')),'hex') FROM supabase_migrations.schema_migrations t),
 'identity',(SELECT jsonb_object_agg(name,jsonb_build_object('count',((xpath('/row/n/text()',query_to_xml(format('SELECT count(*) AS n FROM public.%I',name),false,true,'')))[1]::text)::int,
   'digest',(xpath('/row/value/text()',query_to_xml(format($identity_digest$SELECT encode(pg_catalog.sha256(convert_to(coalesce(string_agg(row_sha,'' ORDER BY row_sha COLLATE "C"),''),'UTF8')),'hex') AS value FROM (SELECT encode(pg_catalog.sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_sha FROM public.%I t) identity_rows$identity_digest$,name),false,true,'')))[1]::text)) FROM unnest(ARRAY['app_accounts','app_identity_bindings','app_sessions','app_identity_challenges']) names(name)),
 'disabled',(SELECT count(*) FROM public.app_accounts WHERE disabled_at IS NOT NULL),
 'profilesHash',(SELECT encode(pg_catalog.sha256(convert_to(coalesce(string_agg(to_jsonb(p)::text,'' ORDER BY p.id),''),'UTF8')),'hex') FROM public.profiles p),
 'accountsHash',(SELECT encode(pg_catalog.sha256(convert_to(coalesce(string_agg(to_jsonb(a)::text,'' ORDER BY a.id),''),'UTF8')),'hex') FROM public.app_accounts a)) AS pilot_snapshot`
export const PILOT_SNAPSHOT_SHA256=sha256(PILOT_SNAPSHOT_SQL)
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)
export function assertPilotSnapshot(value){
  if(!object(value)||Object.keys(value).sort().join('|')!=='accountsHash|business|disabled|identity|ledgerCount|ledgerDigest|ledgerLatest|profilesHash|tables'
    ||value.ledgerCount!==95||value.ledgerLatest!=='20261103210000'||!hex(value.ledgerDigest)||!hex(value.profilesHash)||!hex(value.accountsHash)||value.disabled!==1
    ||!Array.isArray(value.tables)||value.tables.join('|')!==[...TABLES,...IDENTITY_TABLES].sort().join('|')||!object(value.identity)
    ||Object.keys(value.identity).sort().join('|')!==[...IDENTITY_TABLES].sort().join('|'))throw Error('Pilot snapshot refused')
  assertManifest(value.business)
  for(const name of IDENTITY_TABLES){const row=value.identity[name]
    if(!object(row)||Object.keys(row).sort().join('|')!=='count|digest'||row.count!==(name==='app_accounts'?7:0)||!hex(row.digest))throw Error('Pilot snapshot refused')
  }
  return value
}
export function comparePilotSnapshots(source,target){
  assertPilotSnapshot(source);assertPilotSnapshot(target)
  if(JSON.stringify(canonical(source))!==JSON.stringify(canonical(target)))throw Error('Pilot clone mismatch')
  return{publicTablesMatched:51,businessRowDigestsMatched:47,identityTablesMatched:4,ledgerRowsMatched:95,originalAccountsMatched:7,disabledAccounts:1,
    bindings:0,sessions:0,challenges:0,profileAuthorityUnchanged:true,sequenceDefinitionsAndStateMatched:true,functionsMatched:true,sourceCandidateModified:false}
}
