/**
 * Scheduled generation (autoblog-parity XM-07 / MASTER D-07).
 *
 * This repo has NO in-process scheduler — no node-cron, no Inngest, no Vercel
 * cron — so this endpoint is not a break-glass twin of anything: it is the only
 * scheduling path. The org's skale-cron crontab calls it, which is why the whole
 * feature needs no new infrastructure.
 */
import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'

import { generateBlogPost } from '@/lib/blog/generator'

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

  // Cron semantics by default, so a scheduled call stays subject to every
  // cadence gate. ?manual=1 opts into the bypass: with a posting hour set, a
  // cron-semantics call outside that hour can only ever answer "skipped",
  // precisely when a human most wants it to run.
  const manual = new URL(request.url).searchParams.get('manual') === '1'
  const result = await generateBlogPost({ trigger: manual ? 'manual' : 'cron' })

  if (result.status === 'failed') return NextResponse.json(result, { status: 500 })
  return NextResponse.json(result)
}
