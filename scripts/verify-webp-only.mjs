/**
 * verify-webp-only.mjs
 *
 * Scans all Supabase storage buckets and reports any non-WebP raster images.
 * Exits with code 1 if any non-WebP files are found, 0 otherwise.
 *
 * Usage:
 *   node scripts/verify-webp-only.mjs
 *
 * Requires env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

const RASTER_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.avif', '.heic', '.bmp', '.tiff']
const BUCKETS = ['tenant-assets', 'product-images']

// Paths excluded from the check (e.g. OCR temp files are expected to be non-WebP briefly)
const EXCLUDED_PREFIXES = []

function isNonWebpRaster(path) {
  const lower = path.toLowerCase()
  if (EXCLUDED_PREFIXES.some(p => lower.startsWith(p))) return false
  return RASTER_EXTENSIONS.some(ext => lower.endsWith(ext))
}

async function listAllFiles(bucket) {
  const files = []
  async function listDir(prefix) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000 })
    if (error) throw new Error(`list error in ${bucket}/${prefix}: ${error.message}`)
    for (const item of data ?? []) {
      if (item.id === null) {
        await listDir(prefix ? `${prefix}/${item.name}` : item.name)
      } else {
        files.push(prefix ? `${prefix}/${item.name}` : item.name)
      }
    }
  }
  await listDir('')
  return files
}

async function main() {
  console.log('\n=== WebP-Only Verification ===\n')

  const violations = []

  for (const bucket of BUCKETS) {
    console.log(`Scanning: ${bucket}`)
    const files = await listAllFiles(bucket)
    const bad = files.filter(isNonWebpRaster)
    for (const path of bad) {
      violations.push(`${bucket}/${path}`)
    }
    console.log(`  Total files: ${files.length} | Non-WebP raster: ${bad.length}`)
  }

  console.log()
  if (violations.length === 0) {
    console.log('✓ PASS — Zero non-WebP raster images found in permanent storage.')
    process.exit(0)
  } else {
    console.log(`✗ FAIL — ${violations.length} non-WebP raster file(s) found:\n`)
    for (const v of violations) {
      console.log(`  ${v}`)
    }
    console.log('\nRun migrate-images-to-webp.mjs --run to fix.')
    process.exit(1)
  }
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
