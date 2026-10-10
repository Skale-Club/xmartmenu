/**
 * One-shot migration: Supabase Storage -> Cloudflare R2.
 *
 * Copies every object from the Supabase buckets into the matching R2 buckets,
 * verifies each copy byte-for-byte by size, then rewrites the absolute Supabase
 * URLs stored in the DB to the R2 custom-domain URLs.
 *
 * The copy is additive: nothing is deleted from Supabase, so rollback is just
 * unsetting STORAGE_PROVIDER and restoring the DB backup this script writes.
 *
 *   node scripts/migrate-storage-to-r2.mjs --dry-run   # inspect, change nothing
 *   node scripts/migrate-storage-to-r2.mjs             # copy + verify
 *   node scripts/migrate-storage-to-r2.mjs --rewrite   # copy + verify + DB URLs
 */
import { readFileSync, writeFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import pg from 'pg'

const DRY_RUN = process.argv.includes('--dry-run')
const REWRITE = process.argv.includes('--rewrite')

const env = {}
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const t = line.trim()
  if (!t || t.startsWith('#')) continue
  const i = t.indexOf('=')
  if (i === -1) continue
  env[t.slice(0, i)] = t.slice(i + 1).replace(/^["']|["']$/g, '')
}

const required = [
  'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL',
  'STORAGE_S3_ENDPOINT', 'STORAGE_S3_ACCESS_KEY_ID', 'STORAGE_S3_SECRET_ACCESS_KEY',
  'STORAGE_S3_PUBLIC_URL_BASE',
]
const missing = required.filter((k) => !env[k])
if (missing.length) {
  console.error('Missing in .env.local:', missing.join(', '))
  process.exit(1)
}

// Supabase bucket -> R2 bucket
const BUCKETS = {
  'tenant-assets': env.STORAGE_S3_BUCKET_TENANT_ASSETS ?? 'xmartmenu-tenant-assets',
  'product-images': env.STORAGE_S3_BUCKET_PRODUCT_IMAGES ?? 'xmartmenu-product-images',
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const s3 = new S3Client({
  endpoint: env.STORAGE_S3_ENDPOINT,
  region: env.STORAGE_S3_REGION ?? 'auto',
  credentials: {
    accessKeyId: env.STORAGE_S3_ACCESS_KEY_ID,
    secretAccessKey: env.STORAGE_S3_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
})

const publicUrlFor = (r2Bucket, key) =>
  `${env.STORAGE_S3_PUBLIC_URL_BASE.replace('{bucket}', r2Bucket)}/${key}`

/** Recursively list every object key under a Supabase bucket. */
async function listAll(bucket, prefix = '') {
  const out = []
  const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000 })
  if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`)
  for (const entry of data) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    // Supabase returns folders as rows with a null id.
    if (entry.id === null) out.push(...(await listAll(bucket, path)))
    else out.push({ path, size: entry.metadata?.size ?? 0, mime: entry.metadata?.mimetype })
  }
  return out
}

let copied = 0, failed = 0, verified = 0, mismatched = 0
const urlMap = new Map()

for (const [srcBucket, dstBucket] of Object.entries(BUCKETS)) {
  const objects = await listAll(srcBucket)
  const bytes = objects.reduce((a, o) => a + Number(o.size), 0)
  console.log(`\n=== ${srcBucket} -> ${dstBucket} ===`)
  console.log(`${objects.length} objects, ${(bytes / 1024 / 1024).toFixed(1)} MB`)

  for (const obj of objects) {
    const oldUrl = `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${srcBucket}/${obj.path}`
    urlMap.set(oldUrl, publicUrlFor(dstBucket, obj.path))

    if (DRY_RUN) {
      console.log(`  [dry] ${obj.path}  ${(Number(obj.size) / 1024).toFixed(0)} KB  ${obj.mime}`)
      continue
    }

    try {
      const { data, error } = await supabase.storage.from(srcBucket).download(obj.path)
      if (error) throw new Error(error.message)
      const body = Buffer.from(await data.arrayBuffer())

      await s3.send(new PutObjectCommand({
        Bucket: dstBucket,
        Key: obj.path,
        Body: body,
        // Preserve the original mimetype: without it R2 serves
        // application/octet-stream and browsers download instead of render.
        ContentType: obj.mime || 'application/octet-stream',
      }))
      copied++

      const head = await s3.send(new HeadObjectCommand({ Bucket: dstBucket, Key: obj.path }))
      if (Number(head.ContentLength) === body.length) verified++
      else {
        mismatched++
        console.error(`  SIZE MISMATCH ${obj.path}: src=${body.length} dst=${head.ContentLength}`)
      }
      console.log(`  ok  ${obj.path}  ${(body.length / 1024).toFixed(0)} KB  ${head.ContentType}`)
    } catch (err) {
      failed++
      console.error(`  FAIL ${obj.path}: ${err.message}`)
    }
  }
}

console.log(`\ncopied=${copied} failed=${failed} verified=${verified} mismatched=${mismatched}`)
if (failed || mismatched) {
  console.error('Copy incomplete — not touching the database.')
  process.exit(1)
}

if (!REWRITE) {
  console.log('\nURL rewrite skipped (pass --rewrite to apply). Planned mapping:')
  for (const [from, to] of urlMap) console.log(`  ${from}\n    -> ${to}`)
  process.exit(0)
}

// ── DB URL rewrite ───────────────────────────────────────────────────────────
const client = new pg.Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
await client.connect()

const marker = `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/`

// Every text/jsonb column in public that can hold a storage URL.
const cols = await client.query(`
  select table_name, column_name, data_type
  from information_schema.columns
  where table_schema='public'
    and data_type in ('text','character varying','jsonb','json')
  order by table_name, column_name`)

const targets = []
for (const c of cols.rows) {
  const expr = c.data_type.startsWith('js') ? `"${c.column_name}"::text` : `"${c.column_name}"`
  try {
    const { rows } = await client.query(
      `select count(*)::int n from public."${c.table_name}" where ${expr} like $1`, [`%${marker}%`])
    if (rows[0].n > 0) targets.push({ ...c, rows: rows[0].n })
  } catch { /* view or no permission - skip */ }
}

if (!targets.length) {
  console.log('\nNo DB rows reference Supabase storage URLs. Nothing to rewrite.')
  await client.end()
  process.exit(0)
}

console.log('\n=== DB rewrite targets ===')
for (const t of targets) console.log(`  ${t.table_name}.${t.column_name} (${t.data_type}) rows=${t.rows}`)

// Backup the affected columns before touching them.
const backup = {}
for (const t of targets) {
  const { rows } = await client.query(`select * from public."${t.table_name}"`)
  backup[t.table_name] = rows
}
const backupPath = new URL(`../storage-url-rewrite-backup-${Date.now()}.json`, import.meta.url)
writeFileSync(backupPath, JSON.stringify(backup, null, 2))
console.log(`backup written: ${backupPath.pathname}`)

await client.query('BEGIN')
try {
  let totalUpdated = 0
  for (const t of targets) {
    for (const [from, to] of urlMap) {
      const sql = t.data_type.startsWith('js')
        ? `update public."${t.table_name}"
             set "${t.column_name}" = replace("${t.column_name}"::text, $1, $2)::jsonb
           where "${t.column_name}"::text like '%' || $1 || '%'`
        : `update public."${t.table_name}"
             set "${t.column_name}" = replace("${t.column_name}", $1, $2)
           where "${t.column_name}" like '%' || $1 || '%'`
      const r = await client.query(sql, [from, to])
      if (r.rowCount) {
        totalUpdated += r.rowCount
        console.log(`  ${t.table_name}.${t.column_name}: ${r.rowCount} row(s) <- ${to}`)
      }
    }
  }
  await client.query('COMMIT')
  console.log(`\nrewrite committed, ${totalUpdated} row-update(s)`)
} catch (err) {
  await client.query('ROLLBACK')
  console.error('rewrite failed, rolled back:', err.message)
  process.exitCode = 1
}

// Report anything still pointing at Supabase.
for (const t of targets) {
  const expr = t.data_type.startsWith('js') ? `"${t.column_name}"::text` : `"${t.column_name}"`
  const { rows } = await client.query(
    `select count(*)::int n from public."${t.table_name}" where ${expr} like $1`, [`%${marker}%`])
  if (rows[0].n > 0) console.warn(`  REMAINING ${t.table_name}.${t.column_name}: ${rows[0].n} row(s)`)
}

await client.end()
