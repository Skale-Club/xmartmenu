/**
 * migrate-images-to-webp.mjs
 *
 * Scans all Supabase storage buckets for non-WebP raster images, converts them
 * to WebP (quality 80, max 1600px), re-uploads under the .webp path, updates
 * all DB references, and deletes the original file.
 *
 * Usage:
 *   node scripts/migrate-images-to-webp.mjs          # dry-run (no changes)
 *   node scripts/migrate-images-to-webp.mjs --run    # live migration
 *
 * Requires env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { readFileSync } from 'fs'

const DRY_RUN = !process.argv.includes('--run')
const WEBP_QUALITY = 80
const MAX_DIM = 1600

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

const RASTER_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.avif', '.heic', '.bmp', '.tiff']
const BUCKETS = ['tenant-assets', 'product-images']

// DB columns that store image URLs: [table, column]
const IMAGE_COLUMNS = [
  ['tenant_settings', 'logo_url'],
  ['tenant_settings', 'banner_url'],
  ['products', 'image_url'],
  ['platform_settings', 'bg_image_url'],
  ['platform_settings', 'cta_bg_image_url'],
  ['platform_settings', 'favicon_url'],
]

function isRaster(path) {
  const lower = path.toLowerCase()
  return RASTER_EXTENSIONS.some(ext => lower.endsWith(ext))
}

function toWebpPath(path) {
  const lastDot = path.lastIndexOf('.')
  return lastDot >= 0 ? path.slice(0, lastDot) + '.webp' : path + '.webp'
}

async function listAllFiles(bucket) {
  const files = []
  async function listDir(prefix) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000 })
    if (error) throw new Error(`list error in ${bucket}/${prefix}: ${error.message}`)
    for (const item of data ?? []) {
      if (item.id === null) {
        // folder
        await listDir(prefix ? `${prefix}/${item.name}` : item.name)
      } else {
        files.push(prefix ? `${prefix}/${item.name}` : item.name)
      }
    }
  }
  await listDir('')
  return files
}

async function convertToWebP(buffer) {
  return sharp(buffer)
    .resize(MAX_DIM, MAX_DIM, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer()
}

async function migrateFile(bucket, path) {
  const webpPath = toWebpPath(path)

  if (DRY_RUN) {
    console.log(`  [dry-run] would convert: ${bucket}/${path} → ${bucket}/${webpPath}`)
    return { originalPath: path, webpPath, bucket }
  }

  // Download original
  const { data: blob, error: dlErr } = await supabase.storage.from(bucket).download(path)
  if (dlErr) throw new Error(`download failed: ${dlErr.message}`)
  const inputBuffer = Buffer.from(await blob.arrayBuffer())

  // Convert
  const webpBuffer = await convertToWebP(inputBuffer)

  // Upload WebP
  const { error: upErr } = await supabase.storage.from(bucket).upload(webpPath, webpBuffer, {
    contentType: 'image/webp',
    upsert: true,
  })
  if (upErr) throw new Error(`upload failed: ${upErr.message}`)

  // Delete original
  const { error: delErr } = await supabase.storage.from(bucket).remove([path])
  if (delErr) console.warn(`  warn: could not delete original ${path}: ${delErr.message}`)

  console.log(`  converted: ${bucket}/${path} → ${bucket}/${webpPath}`)
  return { originalPath: path, webpPath, bucket }
}

async function updateDbReferences(migrations) {
  if (migrations.length === 0) return

  for (const [table, column] of IMAGE_COLUMNS) {
    const { data: rows, error } = await supabase.from(table).select(`id, ${column}`)
    if (error) { console.warn(`  warn: could not query ${table}.${column}: ${error.message}`); continue }

    for (const row of rows ?? []) {
      const url = row[column]
      if (!url) continue
      for (const { originalPath, webpPath, bucket } of migrations) {
        const originalSuffix = `/${bucket}/${originalPath}`
        const webpSuffix = `/${bucket}/${webpPath}`
        if (url.includes(originalSuffix)) {
          const newUrl = url.replace(originalSuffix, webpSuffix)
          if (DRY_RUN) {
            console.log(`  [dry-run] would update ${table}.${column} id=${row.id}: ${url} → ${newUrl}`)
          } else {
            const { error: updErr } = await supabase.from(table).update({ [column]: newUrl }).eq('id', row.id)
            if (updErr) console.warn(`  warn: failed to update ${table}.${column} id=${row.id}: ${updErr.message}`)
            else console.log(`  updated ${table}.${column} id=${row.id}`)
          }
          break
        }
      }
    }
  }

  // Also update product_media.url and products.image_urls array
  const { data: mediaRows, error: mediaErr } = await supabase.from('product_media').select('id, url')
  if (!mediaErr) {
    for (const row of mediaRows ?? []) {
      const url = row.url
      if (!url) continue
      for (const { originalPath, webpPath, bucket } of migrations) {
        const originalSuffix = `/${bucket}/${originalPath}`
        const webpSuffix = `/${bucket}/${webpPath}`
        if (url.includes(originalSuffix)) {
          const newUrl = url.replace(originalSuffix, webpSuffix)
          if (DRY_RUN) {
            console.log(`  [dry-run] would update product_media.url id=${row.id}`)
          } else {
            const { error: updErr } = await supabase.from('product_media').update({ url: newUrl }).eq('id', row.id)
            if (updErr) console.warn(`  warn: failed to update product_media.url id=${row.id}: ${updErr.message}`)
            else console.log(`  updated product_media.url id=${row.id}`)
          }
          break
        }
      }
    }
  }
}

async function main() {
  console.log(`\n=== WebP Migration Script (${DRY_RUN ? 'DRY-RUN' : 'LIVE'}) ===\n`)

  const migrations = []
  let totalFound = 0

  for (const bucket of BUCKETS) {
    console.log(`\nScanning bucket: ${bucket}`)
    const files = await listAllFiles(bucket)
    const rasterFiles = files.filter(isRaster)
    totalFound += rasterFiles.length

    if (rasterFiles.length === 0) {
      console.log('  No non-WebP raster files found.')
      continue
    }

    console.log(`  Found ${rasterFiles.length} non-WebP raster file(s):`)
    for (const path of rasterFiles) {
      try {
        const result = await migrateFile(bucket, path)
        migrations.push(result)
      } catch (err) {
        console.error(`  ERROR migrating ${bucket}/${path}: ${err.message}`)
      }
    }
  }

  if (totalFound > 0) {
    console.log('\nUpdating database references...')
    await updateDbReferences(migrations)
  }

  console.log(`\n=== Summary ===`)
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN (no changes made)' : 'LIVE'}`)
  console.log(`Non-WebP files found: ${totalFound}`)
  console.log(`Files processed: ${migrations.length}`)
  if (DRY_RUN && totalFound > 0) {
    console.log('\nRe-run with --run flag to apply changes.')
  }
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
