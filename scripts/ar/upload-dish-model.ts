/**
 * Checks a prepared dish model (GLB + optional USDZ) with the same rules as the
 * back-office upload (src/lib/ar/model-file.ts) and uploads it to the
 * product-images bucket under {tenant}/ar/, like
 * POST /api/admin/products/upload-ar-model.
 *
 *   npx tsx scripts/ar/upload-dish-model.ts --tenant <uuid> --glb dish.glb [--usdz dish.usdz]
 *
 * Prints one JSON line with glb_url/glb_storage_path/glb_bytes (and usdz_*),
 * ready for the product_ar_models row. Reads STORAGE_S3_* from .env.local.
 * The row itself is written in the production database (see
 * docs/product/augmented-reality.md, "Generating models").
 */
import { config } from 'dotenv'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

config({ path: resolve(process.cwd(), '.env.local'), quiet: true })

async function main() {
  const { AR_MODEL_CONTENT_TYPES, arModelStoragePath, checkArModelFile } = await import('../../src/lib/ar/model-file')
  const { getStorageClient } = await import('../../src/lib/storage')
  type Format = 'glb' | 'usdz'

  const argv = process.argv.slice(2)
  const arg = (name: string) => { const index = argv.indexOf(`--${name}`); return index >= 0 ? argv[index + 1] : undefined }
  const tenant = arg('tenant')
  if (!tenant || !/^[0-9a-f-]{36}$/.test(tenant) || !arg('glb')) throw new Error('usage: --tenant <uuid> --glb <file> [--usdz <file>]')

  const result: Record<string, string | number> = {}
  for (const format of ['glb', 'usdz'] as Format[]) {
    const file = arg(format)
    if (!file) continue
    const data = new Uint8Array(await readFile(resolve(file)))
    const check = checkArModelFile(data, format)
    if (!check.ok) throw new Error(`${file}: ${check.error}`)
    const path = arModelStoragePath(tenant, format)
    const url = await getStorageClient().upload('product-images', path, data, { contentType: AR_MODEL_CONTENT_TYPES[format] })
    Object.assign(result, { [`${format}_url`]: url, [`${format}_storage_path`]: path, [`${format}_bytes`]: data.length })
  }
  console.log(JSON.stringify(result))
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1) })
