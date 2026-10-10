/**
 * POST /api/superadmin/tenants/[id]/xphere-resync
 *
 * Superadmin-only manual re-sync. Re-enqueues a full Xphere CRM sync for the
 * tenant via the standard producer path enqueueXphereSync(id, 'manual') — the
 * worker fat-reads live tenant state, so this re-sends current truth.
 *
 * Fail-open: enqueueXphereSync never throws (logs-and-swallows publish errors).
 * Ships dark when the XPHERE_* / QSTASH env gate is unconfigured — a harmless
 * no-op. The 'manual' reason emits no timeline note. No request body is read.
 */
import { NextResponse } from 'next/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { enqueueXphereSync } from '@/lib/xphere/queue'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ok = await assertSuperadmin()
  if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  await enqueueXphereSync(id, 'manual')

  return NextResponse.json({ ok: true })
}
