import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { assertPacket, canonical, compareManifests, compatibilitySql, MANIFEST_SQL, TABLES } from './xprout-source-protocol.mjs'
import { authenticateArchive, decryptArchive, encryptArchive, reviewedToc } from './xprout-archive-crypto.mjs'

export const TARGET = 'e12scyfsrp822dag7m9wwd4x'
export function persistentReport(source,target,options={icuUpgradeReviewed:false,collatableColumns:0}) {
  const proof=compareManifests(source,target),{rehearsal,temporaryResourcesRemoved,...counts}=proof
  if(rehearsal!=='passed'||temporaryResourcesRemoved!==true)throw Error('Manifest proof refused')
  return {...counts,persistentImport:'committed_and_reconciled',target:TARGET,database:'xmartmenu',
    localEncryptedArchiveRetained:true,recoveryKeyRetained:true,existingXmailUnchanged:true,
    runtimeLoginEnabled:false,transportConfigured:false,offHostBackupVerified:false,
    textOrderingEqualityCasefoldMatched:true,collatableColumns:options.collatableColumns,
    icuUpgrade:options.icuUpgradeReviewed?{provider:'icu',locale:'en-US',sourceVersion:'153.121',targetVersion:'153.136',explicitOptIn:true}:false}
}
export function sharedCompatibilitySql(ids) {
  const original=compatibilitySql(ids),prefix='CREATE ROLE authenticated NOLOGIN NOBYPASSRLS; CREATE ROLE service_role NOLOGIN NOBYPASSRLS;\n'
  if(!original.startsWith(prefix))throw Error('Reviewed compatibility scaffold drifted')
  return original.slice(prefix.length)
}
export function boundedRestore(sql) {
  if(typeof sql!=='string'||Buffer.byteLength(sql)>64*1024*1024)throw Error('Restore SQL too large')
  const before=sql.indexOf('-- Name:');if(before<0)throw Error('Restore preamble refused')
  let removed=0
  const prefix=sql.slice(0,before).split('\n').filter(line=>{
    if(['SET statement_timeout = 0;','SET lock_timeout = 0;','SET idle_in_transaction_session_timeout = 0;','SET transaction_timeout = 0;'].includes(line)){removed++;return false}
    return true
  }).join('\n')
  if(removed!==4)throw Error('Restore timeout preamble changed')
  return prefix+sql.slice(before)
}
export const TEXT_COLUMNS_SQL=`WITH input AS (
 SELECT jsonb_build_object('table',c.relname,'column',a.attname,'expression',NULL,
 'typeSchema',tn.nspname,'type',t.typname,'elementSchema',en.nspname,'elementType',et.typname,
 'collationSchema',cn.nspname,'collation',co.collname,'deterministic',co.collisdeterministic) AS entry
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_type t ON t.oid=a.atttypid JOIN pg_namespace tn ON tn.oid=t.typnamespace
 LEFT JOIN pg_type et ON et.oid=t.typelem LEFT JOIN pg_namespace en ON en.oid=et.typnamespace
 JOIN pg_collation co ON co.oid=a.attcollation JOIN pg_namespace cn ON cn.oid=co.collnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped AND a.attcollation<>0
 UNION ALL
 SELECT jsonb_build_object('table',c.relname,'column','@index:'||idx.relname||':'||a.attnum,'expression',pg_get_indexdef(i.indexrelid,a.attnum,false),
 'typeSchema',tn.nspname,'type',t.typname,'elementSchema',en.nspname,'elementType',et.typname,
 'collationSchema',cn.nspname,'collation',co.collname,'deterministic',co.collisdeterministic)
 FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class idx ON idx.oid=i.indexrelid
 JOIN pg_attribute a ON a.attrelid=idx.oid AND a.attnum>0 AND a.attnum<=i.indnkeyatts
 JOIN pg_type t ON t.oid=a.atttypid JOIN pg_namespace tn ON tn.oid=t.typnamespace
 LEFT JOIN pg_type et ON et.oid=t.typelem LEFT JOIN pg_namespace en ON en.oid=et.typnamespace
 JOIN pg_collation co ON co.oid=a.attcollation JOIN pg_namespace cn ON cn.oid=co.collnamespace
 WHERE n.nspname='public' AND i.indexprs IS NOT NULL AND i.indkey[a.attnum-1]=0 AND a.attcollation<>0)
 SELECT coalesce(jsonb_agg(entry ORDER BY (entry->>'table') COLLATE "C",(entry->>'column') COLLATE "C"),'[]'::jsonb) AS columns FROM input`
const INDEX_PROOF_SQL=`(SELECT jsonb_build_object('indexes',count(*),'uniqueIndexes',count(*) FILTER(WHERE i.indisunique),
 'indexDefinitions',encode(sha256(convert_to(coalesce(string_agg(pg_get_indexdef(i.indexrelid),'' ORDER BY idx.relname COLLATE "C"),''),'UTF8')),'hex'),
 'constraintDefinitions',(SELECT encode(sha256(convert_to(coalesce(string_agg(pg_get_constraintdef(co.oid),'' ORDER BY t.relname COLLATE "C",co.conname COLLATE "C"),''),'UTF8')),'hex')
 FROM pg_constraint co JOIN pg_class t ON t.oid=co.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public'))
 FROM pg_index i JOIN pg_class idx ON idx.oid=i.indexrelid JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public')`
const ident=value=>`"${value.replaceAll('"','""')}"`
const digest=value=>`encode(sha256(convert_to(${value},'UTF8')),'hex')`
function semanticAggregate(input) {
  return `(WITH input(v) AS (${input}),raw AS (SELECT v,${digest('v::text')} AS h FROM input WHERE v IS NOT NULL),
 classes AS (SELECT ${digest(`string_agg(h,'' ORDER BY h COLLATE "C")`)} AS h FROM raw GROUP BY v)
 SELECT jsonb_build_object('values',(SELECT count(*) FROM raw),
 'ordering',${digest(`coalesce((SELECT string_agg(h,'' ORDER BY v,h COLLATE "C") FROM raw),'')`)},
 'equality',${digest(`coalesce((SELECT string_agg(h,'' ORDER BY h COLLATE "C") FROM classes),'')`)},
 'casefold',${digest(`coalesce((SELECT string_agg(${digest('lower(v::text)')}||${digest('upper(v::text)')},'' ORDER BY h COLLATE "C") FROM raw),'')`)}))`
}
export function semanticFixtureSql() {
  // Fixed synthetic corpus only; no user value, schema override or endpoint input.
  return `SELECT ${semanticAggregate(`SELECT v COLLATE "pg_catalog"."en-US-x-icu" FROM (VALUES ('A'::text),('a'),(''),('e'||chr(769)),(chr(233)),(chr(223)),('ss'),('I'),(chr(305)),(chr(304)),(chr(20013)||chr(25991)),(NULL::text)) fixture(v)`)} AS proof`
}
export function textSemanticsSql(columns) {
  if(!Array.isArray(columns)||columns.length<1||columns.length>1000)throw Error('Collatable schema refused')
  const seen=new Set(),nativeTypes=new Map(),expressions=[]
  const perColumn=columns.map(col=>{
    if(!col||Object.keys(col).sort().join('|')!=='collation|collationSchema|column|deterministic|elementSchema|elementType|expression|table|type|typeSchema'
      ||![col.table,col.typeSchema,col.type,col.collationSchema,col.collation].every(v=>typeof v==='string'&&v.length>0&&v.length<=63)
      ||typeof col.column!=='string'||col.column.length<1||col.column.length>150
      ||!(col.expression===null||(typeof col.expression==='string'&&col.expression.length>0&&col.expression.length<=32768&&col.column.startsWith('@index:')))
      ||!TABLES.includes(col.table)||(col.typeSchema!=='pg_catalog'&&!(col.type==='citext'&&col.typeSchema==='public'))
      ||col.collationSchema!=='pg_catalog'||!['default','C','POSIX','ucs_basic'].includes(col.collation)||col.deterministic!==true
      ||!['text','varchar','bpchar','name','citext','_text','_varchar','_bpchar','_name','_citext'].includes(col.type))throw Error('Unreviewed collatable column')
    const key=col.table+'.'+col.column;if(seen.has(key))throw Error('Duplicate collatable column');seen.add(key)
    const array=col.type.startsWith('_')
    if(array&&(!['pg_catalog','public'].includes(col.elementSchema)||col.elementType!==col.type.slice(1)))throw Error('Array element refused')
    if(!array&&(col.elementSchema!==null||col.elementType!==null))throw Error('Unexpected element type')
    const q=`${ident('public')}.${ident(col.table)}`,field=col.expression===null?`t.${ident(col.column)}`:`(${col.expression})`
    const input=array?`SELECT e.v COLLATE ${ident(col.collationSchema)}.${ident(col.collation)} FROM ${q} t CROSS JOIN LATERAL unnest(${field}) AS e(v)`
      :`SELECT ${field} COLLATE ${ident(col.collationSchema)}.${ident(col.collation)} FROM ${q} t`
    const nativeSchema=array?col.elementSchema:col.typeSchema,nativeType=array?col.elementType:col.type
    nativeTypes.set(nativeSchema+'.'+nativeType,[nativeSchema,nativeType])
    expressions.push(array?`SELECT e.v::text AS v FROM ${q} t CROSS JOIN LATERAL unnest(${field}) AS e(v)`:`SELECT ${field}::text AS v FROM ${q} t`)
    return `jsonb_build_object('column','${key.replaceAll("'","''")}','proof',${semanticAggregate(input)})`
  })
  // Evaluate the combined current value corpus with every native type present.
  // Native GROUP BY preserves citext/bpchar equality as well as ICU sort order.
  const corpus=expressions.join(' UNION ALL ')
  const global=[...nativeTypes].sort(([a],[b])=>a.localeCompare(b,'en')).map(([key,[schema,type]])=>
    `jsonb_build_object('type','${key}','proof',${semanticAggregate(`SELECT v::${ident(schema)}.${ident(type)} COLLATE "pg_catalog"."default" FROM corpus`)})`)
  return `WITH base_corpus AS MATERIALIZED (${corpus}),corpus AS MATERIALIZED (SELECT v COLLATE "pg_catalog"."default" AS v FROM base_corpus UNION ALL SELECT lower(v COLLATE "pg_catalog"."default") FROM base_corpus UNION ALL SELECT upper(v COLLATE "pg_catalog"."default") FROM base_corpus) SELECT jsonb_build_object('version',1,'schemaIndexes',${INDEX_PROOF_SQL},'columns',(SELECT jsonb_agg(p.proof ORDER BY p.position) FROM (VALUES ${perColumn.map((proof,index)=>'('+(index+1)+','+proof+')').join(',')}) p(position,proof)),'global',jsonb_build_array(${global.join(',')})) AS text_semantics`
}
export function assertTextSemantics(source,target) {
  const valid=p=>p&&Object.keys(p).sort().join('|')==='columns|global|schemaIndexes|version'&&p.version===1
    &&p.schemaIndexes&&Number.isSafeInteger(p.schemaIndexes.indexes)&&Number.isSafeInteger(p.schemaIndexes.uniqueIndexes)
    &&['indexDefinitions','constraintDefinitions'].every(k=>/^[a-f0-9]{64}$/.test(p.schemaIndexes[k]))
    &&Array.isArray(p.columns)&&p.columns.length>0&&p.columns.length<=1000&&Array.isArray(p.global)&&p.global.length>0
    &&[...p.columns,...p.global].every(e=>e&&Object.keys(e).length===2&&e.proof
      &&Number.isSafeInteger(e.proof.values)&&e.proof.values>=0&&Object.keys(e.proof).sort().join('|')==='casefold|equality|ordering|values'
      &&['ordering','equality','casefold'].every(k=>/^[a-f0-9]{64}$/.test(e.proof[k])))
  if(!valid(source)||!valid(target)||JSON.stringify(canonical(source))!==JSON.stringify(canonical(target)))throw Error('Text ordering/equality/casefold changed')
}
export function localeSql(locale,allowReviewedIcuUpgrade=false) {
  if(!locale||Object.keys(locale).sort().join('|')!=='actualVersion|collate|ctype|encoding|icuRules|locale|provider|version'
    ||locale.encoding!=='UTF8'||typeof allowReviewedIcuUpgrade!=='boolean'
    ||![locale.collate,locale.ctype].every(v=>typeof v==='string'&&/^[a-zA-Z0-9_.@-]{1,100}$/.test(v))
    ||!(locale.version===null||(typeof locale.version==='string'&&/^[a-zA-Z0-9_.-]{1,100}$/.test(locale.version)))
    ||locale.actualVersion!==locale.version)throw Error('Database locale refused')
  if(allowReviewedIcuUpgrade) {
    if(locale.provider!=='i'||locale.locale!=='en-US'||locale.icuRules!==null||locale.version!=='153.121'
      ||locale.collate!=='en_US.UTF-8'||locale.ctype!=='en_US.UTF-8')throw Error('Unreviewed ICU upgrade')
    const guard="DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_collation c WHERE collname='en-US-x-icu' AND collnamespace='pg_catalog'::regnamespace AND collprovider='i' AND coalesce(to_jsonb(c)->>'colllocale',to_jsonb(c)->>'colliculocale')='en-US' AND collisdeterministic AND collversion='153.136' AND pg_collation_actual_version(oid)='153.136') THEN RAISE EXCEPTION 'Pinned target ICU153.136 unavailable'; END IF; END $$;"
    const create="CREATE DATABASE xmartmenu OWNER xmartmenu_owner TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'en-US' LC_COLLATE 'en_US.UTF-8' LC_CTYPE 'en_US.UTF-8';\nDO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_database d WHERE datname='xmartmenu' AND datlocprovider='i' AND coalesce(to_jsonb(d)->>'datlocale',to_jsonb(d)->>'daticulocale')='en-US' AND to_jsonb(d)->>'daticurules' IS NULL AND datcollate='en_US.UTF-8' AND datctype='en_US.UTF-8' AND pg_encoding_to_char(encoding)='UTF8' AND datcollversion='153.136' AND pg_database_collation_actual_version(oid)='153.136') THEN RAISE EXCEPTION 'New database ICU state mismatch'; END IF; END $$;"
    return {guard,create}
  }
  if(locale.provider!=='c'||locale.locale!==null||locale.icuRules!==null)throw Error('Explicit reviewed ICU flag required')
  const literal=v=>v===null?'NULL':`'${v}'`
  const guard=`DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_collation WHERE collprovider='c' AND collcollate=${literal(locale.collate)} AND collctype=${literal(locale.ctype)} AND pg_collation_actual_version(oid) IS NOT DISTINCT FROM ${literal(locale.version)}) THEN RAISE EXCEPTION 'Equivalent source locale/version unavailable'; END IF; END $$;`
  const create=`CREATE DATABASE xmartmenu OWNER xmartmenu_owner TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER libc LC_COLLATE ${literal(locale.collate)} LC_CTYPE ${literal(locale.ctype)};`
  const verify=`DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_database WHERE datname='xmartmenu' AND datlocprovider='c' AND datcollate=${literal(locale.collate)} AND datctype=${literal(locale.ctype)} AND pg_encoding_to_char(encoding)='UTF8' AND pg_database_collation_actual_version(oid) IS NOT DISTINCT FROM ${literal(locale.version)}) THEN RAISE EXCEPTION 'New database locale mismatch'; END IF; END $$;`
  return {guard,create:create+'\n'+verify}
}
async function input(limit) {
  let size=0;const parts=[]
  for await(const chunk of process.stdin){size+=chunk.length;if(size>limit)throw Error('Input bound exceeded');parts.push(chunk)}
  return Buffer.concat(parts).toString('utf8')
}
async function main(op) {
  const root='/private'
  if(op==='admit') {
    const control=JSON.parse(await input(1048576))
    if(Object.keys(control).sort().join('|')!=='allowReviewedIcuUpgrade|columns|locale|packet|semantics')throw Error('Control packet refused')
    const packet=assertPacket(control.packet),locale=localeSql(control.locale,control.allowReviewedIcuUpgrade),semanticSql=textSemanticsSql(control.columns)
    assertTextSemantics(control.semantics,control.semantics)
    if(control.semantics.columns.length!==control.columns.length)throw Error('Incomplete semantic proof')
    for(const [file,value] of Object.entries({'source-ca.crt':packet.ca,'source-manifest.json':JSON.stringify(packet.manifest),
      'compatibility.sql':sharedCompatibilitySql(packet.authIds),'manifest.sql':MANIFEST_SQL,'snapshot.id':packet.snapshot,
      'locale-guard.sql':locale.guard,'create-database.sql':locale.create,'text-columns.sql':TEXT_COLUMNS_SQL,'text-semantics.sql':semanticSql,
      'source-text-columns.json':JSON.stringify(control.columns),'source-text-semantics.json':JSON.stringify(control.semantics),
      'import-options.json':JSON.stringify({icuUpgradeReviewed:control.allowReviewedIcuUpgrade,collatableColumns:control.columns.length})})) {
      await writeFile(`${root}/${file}`,value+'\n',{flag:'wx',mode:0o600})
    }
    process.stdout.write(packet.environment)
  } else if(op==='toc') {
    await writeFile(`${root}/restore.list`,reviewedToc(await readFile(`${root}/archive.list`,'utf8')),{flag:'wx',mode:0o600})
  } else if(op==='compare'||op==='report') {
    const source=JSON.parse(await readFile(`${root}/source-manifest.json`,'utf8')),target=JSON.parse(await readFile(`${root}/target-manifest.json`,'utf8'))
    const columns=JSON.parse(await readFile(`${root}/source-text-columns.json`,'utf8')),targetColumns=JSON.parse(await readFile(`${root}/target-text-columns.json`,'utf8'))
    if(JSON.stringify(canonical(columns))!==JSON.stringify(canonical(targetColumns)))throw Error('Collatable schema changed')
    assertTextSemantics(JSON.parse(await readFile(`${root}/source-text-semantics.json`,'utf8')),JSON.parse(await readFile(`${root}/target-text-semantics.json`,'utf8')))
    const report=persistentReport(source,target,JSON.parse(await readFile(`${root}/import-options.json`,'utf8')))
    if(op==='report')process.stdout.write(JSON.stringify(report))
  } else if(op==='bound') {
    await writeFile(`${root}/restore-bounded.sql`,boundedRestore(await readFile(`${root}/restore.sql`,'utf8')),{flag:'wx',mode:0o600})
  } else {
    const iterator=process.stdin[Symbol.asyncIterator]();let pending=Buffer.alloc(0),key
    while(key===undefined){const next=await iterator.next();if(next.done)throw Error('Key missing');pending=Buffer.concat([pending,next.value]);const end=pending.indexOf(10)
      if(end<0){if(pending.length>65)throw Error('Key malformed');continue}
      key=pending.subarray(0,end).toString('ascii');pending=pending.subarray(end+1);if(!/^[a-f0-9]{64}$/.test(key))throw Error('Key malformed')}
    if(op==='encrypt') {
      const {Readable}=await import('node:stream')
      const stream=Readable.from((async function*(){if(pending.length)yield pending;for(;;){const next=await iterator.next();if(next.done)break;yield next.value}})())
      await encryptArchive(stream,`${root}/archive.gcm`,key)
    } else if(op==='verify')await authenticateArchive(`${root}/archive.gcm`,key)
    else if(op==='decrypt')await decryptArchive(`${root}/archive.gcm`,process.stdout,key)
    else throw Error('Unknown helper operation')
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main(process.argv[2]).catch(()=>{process.stderr.write('Private import helper failed; details omitted.');process.exitCode=1})
