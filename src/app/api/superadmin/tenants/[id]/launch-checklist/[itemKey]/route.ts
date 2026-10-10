import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { isLaunchChecklistKey, isLaunchChecklistStatus } from '@/lib/launch-checklist'
import { LaunchChecklistSetupError, setLaunchChecklistItem } from '@/lib/admin/launch-checklist-data'

// Set one launch-checklist item for one restaurant (super-admin → Clients →
// Launch checklist). Body: { status: 'pending' | 'done' | 'na', note?: string }.
// An omitted note keeps the stored one, so ticking a box never wipes it.
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; itemKey: string }> },
) {
  const { id, itemKey } = await params
  const supabase = await assertSuperadmin()
  if (!supabase) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isLaunchChecklistKey(itemKey)) return NextResponse.json({ error: 'Unknown checklist item' }, { status: 400 })

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || !isLaunchChecklistStatus(body.status)) {
    return NextResponse.json({ error: 'Invalid checklist update' }, { status: 400 })
  }
  if (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 2000)) {
    return NextResponse.json({ error: 'Invalid note' }, { status: 400 })
  }
  const note = typeof body.note === 'string' ? body.note.trim() : undefined

  const { data: { user } } = await supabase.auth.getUser()
  try {
    const entry = await setLaunchChecklistItem(createServiceClient(), {
      tenantId: id,
      itemKey,
      status: body.status,
      note,
      updatedBy: user?.email ?? null,
    })
    if (!entry) return NextResponse.json({ error: 'Restaurant not found' }, { status: 404 })
    return NextResponse.json(entry)
  } catch (error) {
    if (error instanceof LaunchChecklistSetupError) return NextResponse.json({ error: error.message }, { status: 503 })
    console.error('PUT /api/superadmin/tenants/[id]/launch-checklist/[itemKey]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
