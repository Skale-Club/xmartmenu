import {nativeBlogSelected,legacyBlogWritesBlocked,LEGACY_BLOG_WRITES_MESSAGE} from '@/lib/blog/native/selected'
import {nativeBlogCronHttp} from '@/lib/blog/native/cron-http'
/**
 * Scheduled RSS ingestion (autoblog-parity XM-05/XM-07). Same authorisation and
 * the same reasoning as the generate route next door.
 */
import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { runRssSweep } from '@/lib/blog/sweep'


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

  // Sweeps every scope that has BOTH the blog and RSS on (autoblog-parity
  // XM-14) — the platform's own and each restaurant's. A scope with RSS off
  // opens no sockets at all.
  if(nativeBlogSelected())return nativeBlogCronHttp(request,'rss')
  if(legacyBlogWritesBlocked())return NextResponse.json({error:LEGACY_BLOG_WRITES_MESSAGE},{status:503})
  return NextResponse.json(await runRssSweep())
}
