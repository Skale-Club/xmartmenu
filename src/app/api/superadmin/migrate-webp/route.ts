import { assertSuperadmin } from '@/lib/superadmin-auth'
import { createServiceClient } from '@/lib/supabase/server'
import { getStorageClient } from '@/lib/storage'
import { convertBufferToWebP } from '@/lib/upload'
import { NextResponse } from 'next/server'

const RASTER_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.avif', '.heic', '.bmp', '.tiff']
const BUCKETS = ['tenant-assets', 'product-images'] as const

// DB columns that store image URLs
const IMAGE_COLUMNS: [string, string][] = [
  ['tenant_settings', 'logo_url'],
  ['tenant_settings', 'banner_url'],
  ['products', 'image_url'],
  ['platform_settings', 'bg_image_url'],
  ['platform_settings', 'cta_bg_image_url'],
  ['platform_settings', 'favicon_url'],
]

function isRaster(name: string) {
  const lower = name.toLowerCase()
  return RASTER_EXTENSIONS.some(ext => lower.endsWith(ext))
}

function toWebpName(name: string) {
  const lastDot = name.lastIndexOf('.')
  return lastDot >= 0 ? name.slice(0, lastDot) + '.webp' : name + '.webp'
}

async function listAll(supabase: Awaited<ReturnType<typeof createServiceClient>>, bucket: string) {
  const files: string[] = []
  async function listDir(prefix: string) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000 })
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`)
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

type Migration = { bucket: string; originalPath: string; webpPath: string; originalUrl: string; webpUrl: string }

function isAuthorized(request: Request): boolean {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const header = request.headers.get('x-migration-key')
  if (serviceKey && header === serviceKey) return true
  return false
}

export async function POST(request: Request) {
  const authorized = isAuthorized(request) || await assertSuperadmin()
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { dryRun = true } = await request.json().catch(() => ({}))
  const supabase = await createServiceClient()
  const storage = getStorageClient()
  const log: string[] = []
  const migrations: Migration[] = []

  for (const bucket of BUCKETS) {
    const files = await listAll(supabase, bucket)
    const rasterFiles = files.filter(isRaster)

    log.push(`${bucket}: ${files.length} total, ${rasterFiles.length} non-WebP raster`)

    for (const path of rasterFiles) {
      const webpPath = toWebpName(path)
      const originalUrl = storage.getPublicUrl(bucket as 'tenant-assets' | 'product-images', path)
      const webpUrl = storage.getPublicUrl(bucket as 'tenant-assets' | 'product-images', webpPath)

      if (dryRun) {
        log.push(`  [dry-run] ${bucket}/${path} → ${webpPath}`)
        migrations.push({ bucket, originalPath: path, webpPath, originalUrl, webpUrl })
        continue
      }

      try {
        // Download original
        const inputBuffer = await storage.download(bucket as 'tenant-assets' | 'product-images', path)

        // Convert to WebP
        const webpBuffer = await convertBufferToWebP(inputBuffer)

        // Upload WebP
        await storage.upload(bucket as 'tenant-assets' | 'product-images', webpPath, webpBuffer, {
          contentType: 'image/webp',
          upsert: true,
        })

        // Update DB references
        for (const [table, column] of IMAGE_COLUMNS) {
          await supabase
            .from(table as any)
            .update({ [column]: webpUrl } as any)
            .like(column, `%/${path}%`)
        }

        // Update product_media URLs
        await supabase
          .from('product_media' as any)
          .update({ url: webpUrl } as any)
          .like('url', `%/${path}%`)

        // Update products image_urls array
        const { data: prods } = await supabase
          .from('products' as any)
          .select('id, image_urls')
          .not('image_urls', 'is', null) as any
        for (const prod of prods ?? []) {
          if (Array.isArray(prod.image_urls) && prod.image_urls.some((u: string) => u.includes(path))) {
            const updated = prod.image_urls.map((u: string) => u.includes(path) ? u.replace(path, webpPath) : u)
            await supabase.from('products' as any).update({ image_urls: updated } as any).eq('id', prod.id)
          }
        }

        // Delete original
        await supabase.storage.from(bucket).remove([path])

        log.push(`  converted: ${bucket}/${path} → ${webpPath}`)
        migrations.push({ bucket, originalPath: path, webpPath, originalUrl, webpUrl })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log.push(`  ERROR: ${bucket}/${path}: ${msg}`)
      }
    }
  }

  return NextResponse.json({ dryRun, migrations, log })
}

// GET: quick inventory
export async function GET(request: Request) {
  const authorized = isAuthorized(request) || await assertSuperadmin()
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServiceClient()
  const report: Record<string, { total: number; nonWebp: string[] }> = {}

  for (const bucket of BUCKETS) {
    const files = await listAll(supabase, bucket)
    report[bucket] = { total: files.length, nonWebp: files.filter(isRaster) }
  }

  return NextResponse.json({ report })
}
