/**
 * Scheduled generation (autoblog-parity XM-07 / MASTER D-07).
 *
 * This repo has NO in-process scheduler — no node-cron, no Inngest, no Vercel
 * cron — so this endpoint is not a break-glass twin of anything: it is the only
 * scheduling path. The org's skale-cron crontab calls it, which is why the whole
 * feature needs no new infrastructure.
 *
 * One call covers every blog: the platform's own and each restaurant that has
 * the feature on (XM-14). The crontab entry never changes as tenants come and
 * go — the sweep reads which scopes are enabled every time it runs.
 */
import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'

import { runBlogSweep } from '@/lib/blog/sweep'

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

  // One call sweeps EVERY enabled blog — the platform's and every restaurant's
  // (autoblog-parity XM-14). Each scope applies its own cadence in its own
  // timezone, so the crontab entry never has to change as tenants are added.
  const summary = await runBlogSweep({ trigger: manual ? 'manual' : 'cron' })

  // A per-scope failure is reported, not raised: one restaurant with a bad API
  // key must not make the whole sweep look broken to the scheduler, which would
  // otherwise retry the ones that already succeeded.
  return NextResponse.json(summary)
}
