import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { ownedAuthSelected } from '@/lib/auth/owned-principal'
import { ownedAdminTransaction } from '@/lib/data/admin-menus-runtime'
import { notifyAbandonedDraft } from '@/lib/access-requests/notify'
import { abandonedDrafts, isMissingAccessRequestsTable, markAbandonedNotified } from '@/lib/access-requests/store'

export const dynamic = 'force-dynamic'

const headers = { 'Cache-Control': 'private, no-store' }

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const a = Buffer.from(request.headers.get('authorization') ?? '')
  const b = Buffer.from(`Bearer ${secret}`)
  if (a.length !== b.length) return false
  try { return timingSafeEqual(a, b) } catch { return false }
}

/** Announces drafts idle for 30 minutes to the team, once each. Called by the org's cron. */
export async function POST(request: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503, headers })
  if (!isAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
  if (!ownedAuthSelected()) return NextResponse.json({ error: 'Not found' }, { status: 404, headers })
  try {
    const drafts = await ownedAdminTransaction(false, query => abandonedDrafts(query, 30, 50))
    let notified = 0
    for (const draft of drafts) {
      if (!(await notifyAbandonedDraft(draft))) continue
      await ownedAdminTransaction(true, query => markAbandonedNotified(query, draft.id))
      notified += 1
    }
    return NextResponse.json({ checked: drafts.length, notified }, { headers })
  } catch (error) {
    if (isMissingAccessRequestsTable(error)) return NextResponse.json({ checked: 0, notified: 0, unavailable: true }, { headers })
    console.error('access_request.abandoned_failed', error instanceof Error ? error.name : 'unknown')
    return NextResponse.json({ error: 'Abandoned-draft check is unavailable.' }, { status: 503, headers })
  }
}
