import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { assertTextSemantics, boundedRestore, localeSql, persistentReport, sharedCompatibilitySql, textSemanticsSql } from './import-xprout-private-candidate.helper.mjs'
import { SEQUENCES, TABLES } from './xprout-source-protocol.mjs'
const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash'
function manifest() {
  const hash='a'.repeat(64), counts=Object.fromEntries(TABLES.map(n=>[n,0]))
  Object.assign(counts,{profiles:7,tenants:3,products:56,orders:2,order_items:6})
  return { version:1,publicTableCount:47,counts,digests:Object.fromEntries(TABLES.map(n=>[n,hash])),
    criticalDigests:Object.fromEntries(['auth_ids','order_items','orders','product_tenants','profile_authority','tenants'].map(n=>[n,hash])),
    functionDigest:hash,authIdCount:7,orphanProfiles:0,authWithoutProfile:0,roles:{superadmin:1,'store-admin':3,customer:3},
    orderTotals:[{status:'cancelled',currency:null,count:1,total:'247.90'},{status:'pending',currency:null,count:1,total:'77.90'}],
    sequenceCount:2,sequences:Object.fromEntries(Object.entries(SEQUENCES).map(([name,table])=>[name,{type:'bigint',start:'1',increment:'1',minimum:'1',maximum:'9223372036854775807',cache:'1',cycle:false,ownership:'a',tableSchema:'public',table,column:'id',lastValue:'1',isCalled:false}])),
    ledgerCount:92,ledgerLatest:'20261027097000',ledgerDigest:hash }
}
test('both persistent import entrypoints default to offline plans and refuse overrides',()=>{
  for(const [binary,path] of [[process.execPath,'scripts/ops/import-xprout-private-candidate.mjs'],[bash,'scripts/ops/import-xprout-private-candidate.sh']]) {
    for(const args of [[],['--plan']]) {
      const r=spawnSync(binary,[path,...args],{encoding:'utf8',timeout:4000}); assert.equal(r.status,0,r.stderr); assert.match(r.stdout,/PLAN ONLY/)
    }
    for(const args of [['--apply'],['--execute-reviewed-import','--host','other']]) {
      const r=spawnSync(binary,[path,...args],{encoding:'utf8',timeout:4000}); assert.equal(r.status,2,r.stderr)
    }
  }
  assert.equal(spawnSync(bash,['-n','scripts/ops/import-xprout-private-candidate.sh'],{encoding:'utf8'}).status,0)
})
test('persistent proof preserves all data gates and never implies login, transport or offhost recovery',()=>{
  const a=manifest(),b=structuredClone(a),r=persistentReport(a,b)
  assert.equal(r.publicTableCountsMatched,47); assert.equal(r.persistentImport,'committed_and_reconciled')
  assert.equal(r.applicationCutover,false); assert.equal(r.loginMigrated,false); assert.equal(r.runtimeLoginEnabled,false)
  assert.equal(r.transportConfigured,false); assert.equal(r.offHostBackupVerified,false)
  assert.equal('temporaryResourcesRemoved' in r,false)
  for(const mutate of [m=>m.digests.orders='b'.repeat(64),m=>m.orderTotals[0].currency='USD',m=>m.roles.superadmin=2,m=>m.sequences.audit_events_id_seq.isCalled=true,m=>m.functionDigest='b'.repeat(64)]) {
    const changed=structuredClone(b); mutate(changed); assert.throws(()=>persistentReport(a,changed))
  }
})
test('database-local compatibility cannot recreate or alter cluster-global Auth roles',()=>{
  const ids=Array.from({length:7},()=>randomUUID()),sql=sharedCompatibilitySql(ids)
  assert.doesNotMatch(sql,/CREATE ROLE|ALTER ROLE|GRANT .*authenticated|PASSWORD|sessions|refresh/i)
  assert.match(sql,/CREATE TABLE auth.users\(id uuid PRIMARY KEY\)/)
  for(const id of ids)assert.ok(sql.includes(id))
  assert.throws(()=>sharedCompatibilitySql([...ids.slice(0,6),"'); DROP DATABASE xmail;--"]))
})
test('source database locale is preserved exactly or refused before any target creation',()=>{
  const input={encoding:'UTF8',provider:'c',collate:'C',ctype:'C',locale:null,icuRules:null,version:null,actualVersion:null},s=localeSql(input)
  assert.match(s.guard,/pg_collation_actual_version\(oid\) IS NOT DISTINCT FROM NULL/)
  assert.match(s.create,/CREATE DATABASE xmartmenu OWNER xmartmenu_owner TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER libc LC_COLLATE 'C' LC_CTYPE 'C'/)
  assert.match(s.create,/pg_database_collation_actual_version/)
  for(const patch of [{collate:"C';DROP DATABASE xmail;--"},{provider:'i'},{encoding:'LATIN1'},{version:'1;evil'},{extra:true}])assert.throws(()=>localeSql({...input,...patch}))
})
test('bounded restore changes only the four exact timeout-disabling preamble lines',()=>{
  const header=['SET statement_timeout = 0;','SET lock_timeout = 0;','SET idle_in_transaction_session_timeout = 0;','SET transaction_timeout = 0;'].join('\n')+'\n'
  const body="-- Name: fixture; Type: FUNCTION; Schema: public\nCREATE FUNCTION public.fixture() RETURNS text AS $$ SELECT 'SET statement_timeout = 0;'::text $$ LANGUAGE sql;\nCOPY fixture FROM stdin;\nSET lock_timeout = 0;\n\\.\n"
  assert.equal(boundedRestore(header+body),body)
  assert.throws(()=>boundedRestore(header.replace('SET transaction_timeout = 0;','')+body))
  assert.throws(()=>boundedRestore(header))
})
test('operator pins cluster and own names, preserves existing data and only grants dormant roles',()=>{
  const sh=readFileSync(new URL('./import-xprout-private-candidate.sh',import.meta.url),'utf8')
  assert.match(sh,/target=e12scyfsrp822dag7m9wwd4x/); assert.match(sh,/volume\|postgres-data-\$target\|true/)
  assert.match(sh,/EXISTS\(SELECT FROM pg_database WHERE datname='xmartmenu'\)/)
  assert.doesNotMatch(sh,/DROP DATABASE|DROP ROLE|ALTER ROLE (authenticated|service_role|xmail_owner|xmail_runtime)|docker (restart|stop|volume|network)/)
  assert.match(sh,/CREATE ROLE xmartmenu_runtime NOLOGIN/); assert.match(sh,/CREATE ROLE xmartmenu_owner NOLOGIN/)
  assert.ok(sh.indexOf('archive.key"; sync -f')<sh.indexOf('CREATE ROLE xmartmenu_owner'))
  assert.ok(sh.indexOf('run_helper compare >')<sh.indexOf("printf 'COMMIT;"))
  assert.match(sh,/cmp -s "\$work\/xmail-before.json" "\$work\/xmail-after.json"/)
})
test('ICU upgrade requires an explicit flag and pins source provider/locale/rules/recorded-actual versions',()=>{
  const locale={encoding:'UTF8',provider:'i',collate:'en_US.UTF-8',ctype:'en_US.UTF-8',locale:'en-US',icuRules:null,version:'153.121',actualVersion:'153.121'}
  assert.throws(()=>localeSql(locale))
  const sql=localeSql(locale,true)
  assert.match(sql.guard,/collversion='153.136'.*pg_collation_actual_version\(oid\)='153.136'/)
  assert.match(sql.create,/LOCALE_PROVIDER icu ICU_LOCALE 'en-US'/)
  assert.match(sql.create,/datcollversion='153.136'/)
  for(const patch of [{actualVersion:'153.136'},{version:'153.136',actualVersion:'153.136'},{locale:'und'},{icuRules:'custom'},{collate:'C'},{provider:'c'}])assert.throws(()=>localeSql({...locale,...patch},true))
})
test('all collatable scalar/array columns plus global native-type corpus receive order/equality/casefold proofs',()=>{
  const col={table:'products',column:'name',expression:null,typeSchema:'pg_catalog',type:'text',elementSchema:null,elementType:null,collationSchema:'pg_catalog',collation:'default',deterministic:true}
  const sql=textSemanticsSql([col,{...col,column:'tags',type:'_text',elementSchema:'pg_catalog',elementType:'text'}])
  assert.match(sql,/unnest\(t\."tags"\)/)
  assert.match(sql,/GROUP BY v/);assert.match(sql,/ORDER BY v,h COLLATE "C"/)
  assert.match(sql,/lower\(v::text\)/);assert.match(sql,/upper\(v::text\)/)
  assert.match(sql,/base_corpus AS MATERIALIZED/);assert.match(sql,/UNION ALL SELECT lower/)
  const expression=textSemanticsSql([{...col,column:'@index:fixture:1',expression:'lower(name)'}]);assert.match(expression,/SELECT \(lower\(name\)\) COLLATE/)
  for(const patch of [{type:'jsonb'},{collation:'unreviewed'},{deterministic:false},{table:'not_an_app_table'},{typeSchema:'extensions'}])assert.throws(()=>textSemanticsSql([{...col,...patch}]))
  assert.throws(()=>textSemanticsSql([col,col]))
  // Avoid PostgreSQL's100-function-argument limit for real schemas with many columns.
  assert.doesNotThrow(()=>textSemanticsSql(Array.from({length:120},(_,i)=>({...col,column:'column_'+i}))))
})
test('any ordering/equality/casefold or value-count drift aborts before commit',()=>{
  const hash='a'.repeat(64),p={values:4,ordering:hash,equality:hash,casefold:hash}
  const source={version:1,schemaIndexes:{indexes:2,uniqueIndexes:1,indexDefinitions:hash,constraintDefinitions:hash},columns:[{column:'products.name',proof:p}],global:[{type:'pg_catalog.text',proof:p}]}
  assert.doesNotThrow(()=>assertTextSemantics(source,structuredClone(source)))
  for(const dimension of ['ordering','equality','casefold','values']) {
    const changed=structuredClone(source);changed.columns[0].proof[dimension]=dimension==='values'?5:'b'.repeat(64)
    assert.throws(()=>assertTextSemantics(source,changed))
  }
  const indexChanged=structuredClone(source);indexChanged.schemaIndexes.indexDefinitions='b'.repeat(64);assert.throws(()=>assertTextSemantics(source,indexChanged))
  const changed=structuredClone(source);changed.global[0].proof.equality='b'.repeat(64)
  assert.throws(()=>assertTextSemantics(source,changed))
})
