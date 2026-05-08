import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// Load .env.local manually (no dotenv dependency needed)
const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '../.env.local')
const envLines = readFileSync(envPath, 'utf8').split('\n')
const env = {}
for (const line of envLines) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const eqIdx = trimmed.indexOf('=')
  if (eqIdx === -1) continue
  env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1)
}

const supabaseUrl = env['NEXT_PUBLIC_SUPABASE_URL']
const serviceRoleKey = env['SUPABASE_SERVICE_ROLE_KEY']

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey)

const BUCKETS = ['tenant-assets', 'product-images']
// cacheControl: '31536000' = 1 year in seconds
// Supabase Storage sets: Cache-Control: public, max-age=31536000, immutable
const CACHE_SECONDS = '31536000'

for (const bucket of BUCKETS) {
  const { data, error } = await supabase.storage.updateBucket(bucket, {
    cacheControl: CACHE_SECONDS,
    public: true,
  })
  if (error) {
    console.error(`Failed to update bucket '${bucket}':`, error.message)
    process.exit(1)
  }
  console.log(`Bucket '${bucket}' updated — cacheControl: ${CACHE_SECONDS}`)
}

console.log('CDN cache configuration complete.')
