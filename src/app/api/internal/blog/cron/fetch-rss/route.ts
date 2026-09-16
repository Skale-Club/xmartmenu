/**
 * Scheduled RSS ingestion (autoblog-parity XM-05/XM-07). Same authorisation and
 * the same reasoning as the generate route next door.
 */
import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'

import { createServiceClient } from '@/lib/supabase/server'
import { fetchAllRssSources } from '@/lib/blog/rss'
import { loadBlogSettings } from '@/lib/blog/generator'

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const provided = request.headers.get('authorization') ?? ''
  const a = Buffer.from(provided)
  const b = Buffer.from(`Bearer ${secret}`)
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export async function POST(request: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  }
  if (!isAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient()
  const settings = await loadBlogSettings(service)
  // No point opening sockets for a feature that is switched off.
  if (!settings?.rss_enabled) return NextResponse.json({ skipped: true, reason: 'rss_disabled' })

  return NextResponse.json(await fetchAllRssSources(service))
}
