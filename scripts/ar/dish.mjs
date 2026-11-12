#!/usr/bin/env node
/**
 * One command per AR dish, driven by the sizes in scripts/ar/dishes/<tenant>.json.
 *
 *   node scripts/ar/dish.mjs prepare <tenant> <dish>   # Blender: size from the manifest, GLB + USDZ + preview
 *   node scripts/ar/dish.mjs publish <tenant> <dish>   # R2 upload + product_ar_models row in production
 *
 * Files live in $AR_MODELS_DIR/<tenant>/ (raw/<dish>.glb from Rodin, blend/<dish>.blend,
 * out/<dish>.{glb,usdz,png}). `prepare` builds the .blend from the raw model the first
 * time (food size + plate), and afterwards only resizes the existing .blend, so manual
 * Blender edits and the food grade are kept. The owner reviews every dish in the Blender
 * window before `publish` (see docs/product/augmented-reality.md).
 *
 * Env (.env.local): AR_MODELS_DIR, optional BLENDER_BIN, AR_PROD_SSH (default
 * root@188.245.112.3), plus STORAGE_S3_* for the upload.
 */
import { config } from 'dotenv'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

config({ path: resolve(process.cwd(), '.env.local'), quiet: true })

const [action, tenantSlug, dish] = process.argv.slice(2)
if (!['prepare', 'publish'].includes(action) || !tenantSlug || !dish) {
  console.error('usage: node scripts/ar/dish.mjs prepare|publish <tenant-slug> <dish>')
  process.exit(2)
}

const manifest = JSON.parse(readFileSync(resolve('scripts/ar/dishes', `${tenantSlug}.json`), 'utf8'))
const entry = manifest.dishes[dish]
if (!entry) throw new Error(`${dish} is not in scripts/ar/dishes/${tenantSlug}.json`)
const spec = { ...manifest.defaults[entry.category], ...entry }

const root = process.env.AR_MODELS_DIR
if (!root) throw new Error('AR_MODELS_DIR is missing from .env.local')
const dir = join(root, tenantSlug)
const file = (folder, ext) => join(dir, folder, `${dish}.${ext}`)

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options })
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}):\n${(result.stderr || result.stdout || '').slice(-3000)}`)
  return result.stdout
}

function prepare() {
  const blender = process.env.BLENDER_BIN ?? 'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe'
  const blend = file('blend', 'blend')
  const args = ['-b', '--factory-startup', '--python', 'scripts/ar/prepare-dish-model.py', '--']
  if (existsSync(blend)) {
    args.push('--from-blend', blend)
    if (spec.height_cm) args.push('--fit-height-cm', String(spec.height_cm))
    else if (spec.plate_cm) args.push('--fit-width-cm', String(spec.plate_cm))
    else if (spec.food_cm) args.push('--fit-width-cm', String(spec.food_cm))
  } else {
    const raw = file('raw', 'glb')
    if (!existsSync(raw)) throw new Error(`no ${raw}: generate the dish first`)
    args.push('--in', raw)
    if (spec.height_cm) args.push('--height-cm', String(spec.height_cm))
    else {
      const food = spec.food_cm ?? (spec.plate_cm && spec.food_ratio ? spec.plate_cm * spec.food_ratio : null)
      if (!food) throw new Error(`${dish}: set food_cm, plate_cm + food_ratio, or height_cm`)
      args.push('--width-cm', String(food))
      if (spec.plate_cm) args.push('--plate-cm', String(spec.plate_cm))
    }
  }
  args.push('--save-blend', blend, '--out-glb', file('out', 'glb'), '--out-usdz', file('out', 'usdz'), '--preview', file('out', 'png'))
  let out = run(blender, args)
  // A new dish gets the food grade the owner approved (manifest "grade"), applied
  // from the original texture on a second pass over the fresh .blend.
  const grade = { ...manifest.grade, ...spec.grade }
  if (args.includes('--in') && Object.keys(grade).length) {
    out = run(blender, ['-b', '--factory-startup', '--python', 'scripts/ar/prepare-dish-model.py', '--', '--from-blend', blend,
      ...(grade.contrast ? ['--food-contrast', String(grade.contrast)] : []),
      ...(grade.saturation ? ['--food-saturation', String(grade.saturation)] : []),
      ...(grade.sharpen !== undefined ? ['--food-sharpen', String(grade.sharpen)] : []),
      '--save-blend', blend, '--out-glb', file('out', 'glb'), '--out-usdz', file('out', 'usdz'), '--preview', file('out', 'png')])
  }
  const line = out.split(/\r?\n/).find(text => text.startsWith('PREPARED '))
  if (!line) throw new Error(`Blender gave no result:\n${out.slice(-3000)}`)
  console.log(JSON.stringify({ dish, blend, ...JSON.parse(line.slice(9)) }))
}

/** Same writer rules as the back office: tenant check, advisory lock, one transaction, upsert. */
const UPSERT = `
const { Client } = require('pg');
(async () => {
  const { tenantId, product, row } = JSON.parse(Buffer.from(process.env.AR_ROW, 'base64').toString());
  const c = new Client({ connectionString: process.env.ADMIN_MENUS_DATABASE_URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['xmartmenu-admin-menus:' + tenantId]);
    const p = await c.query('SELECT id FROM products WHERE tenant_id=$1 AND name=$2', [tenantId, product]);
    if (p.rowCount !== 1) throw new Error(p.rowCount + ' products named ' + product);
    await c.query(\`INSERT INTO public.product_ar_models(tenant_id,product_id,glb_url,glb_storage_path,glb_bytes,usdz_url,usdz_storage_path,usdz_bytes,real_scale,scale,model_width_cm)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,1,$9)
      ON CONFLICT (product_id) DO UPDATE SET glb_url=EXCLUDED.glb_url,glb_storage_path=EXCLUDED.glb_storage_path,glb_bytes=EXCLUDED.glb_bytes,
        usdz_url=EXCLUDED.usdz_url,usdz_storage_path=EXCLUDED.usdz_storage_path,usdz_bytes=EXCLUDED.usdz_bytes,real_scale=true,scale=1,
        model_width_cm=EXCLUDED.model_width_cm,updated_at=now()\`,
      [tenantId, p.rows[0].id, row.glb_url, row.glb_storage_path, row.glb_bytes, row.usdz_url ?? null, row.usdz_storage_path ?? null, row.usdz_bytes ?? null, row.model_width_cm]);
    await c.query('COMMIT');
    const back = await c.query('SELECT glb_url, usdz_url, scale, model_width_cm, updated_at FROM product_ar_models WHERE product_id=$1', [p.rows[0].id]);
    console.log(JSON.stringify(back.rows[0]));
  } catch (e) { await c.query('ROLLBACK'); throw e } finally { await c.end() }
})().catch(e => { console.error(e.message); process.exit(1) });
`

function publish() {
  for (const ext of ['glb', 'usdz']) if (!existsSync(file('out', ext))) throw new Error(`no ${file('out', ext)}: run prepare first`)
  // tsx through node itself: no shell, so paths with spaces (My Drive) stay one argument.
  const uploaded = JSON.parse(run(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/ar/upload-dish-model.ts',
    '--tenant', manifest.tenant_id, '--glb', file('out', 'glb'), '--usdz', file('out', 'usdz')]).trim().split(/\r?\n/).pop())
  const size = JSON.parse(run(process.execPath, ['-e', `
    const b=require('fs').readFileSync(process.argv[1]);const n=b.readUInt32LE(12);const j=JSON.parse(b.subarray(20,20+n));
    const acc=j.accessors;let lo=[1e9,1e9,1e9],hi=[-1e9,-1e9,-1e9];for(const m of j.meshes)for(const p of m.primitives){const a=acc[p.attributes.POSITION];a.min.forEach((v,i)=>lo[i]=Math.min(lo[i],v));a.max.forEach((v,i)=>hi[i]=Math.max(hi[i],v))}
    console.log(JSON.stringify({width_cm:Math.round(Math.max(hi[0]-lo[0],hi[2]-lo[2])*1000)/10}))`, file('out', 'glb')]))
  const row = { ...uploaded, model_width_cm: size.width_cm }
  const ssh = process.env.AR_PROD_SSH ?? 'root@188.245.112.3'
  const container = run('ssh', ['-o', 'BatchMode=yes', ssh, "docker ps --format '{{.Names}}' | grep '^app-gmaayluj11x1m6j7baogonfn-' | head -1"]).trim()
  if (!container) throw new Error('production app container not found')
  const payload = Buffer.from(JSON.stringify({ tenantId: manifest.tenant_id, product: entry.product, row })).toString('base64')
  const saved = run('ssh', ['-o', 'BatchMode=yes', ssh, `docker exec -i -e AR_ROW=${payload} ${container} node -`], { input: UPSERT })
  console.log(JSON.stringify({ dish, product: entry.product, ...JSON.parse(saved.trim()) }))
}

if (action === 'prepare') prepare()
else publish()
