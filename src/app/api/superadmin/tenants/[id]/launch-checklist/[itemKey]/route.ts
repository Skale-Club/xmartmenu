import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { isLaunchChecklistKey, isLaunchChecklistStatus, type LaunchChecklistEntry } from '@/lib/launch-checklist'
import { isMissingLaunchChecklistTable } from '@/lib/admin/launch-checklist-data'

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
  const service = createServiceClient()
  const { data: tenant } = await service.from('tenants').select('id').eq('id', id).maybeSingle()
  if (!tenant) return NextResponse.json({ error: 'Restaurant not found' }, { status: 404 })

  const row: Record<string, unknown> = {
    tenant_id: id,
    item_key: itemKey,
    status: body.status,
    updated_by: user?.email ?? null,
    updated_at: new Date().toISOString(),
  }
  if (note !== undefined) row.note = note

  const { data, error } = await service
    .from('launch_checklist_items')
    .upsert(row, { onConflict: 'tenant_id,item_key' })
    .select('status, note, updated_by, updated_at')
    .single()
  if (error) {
    if (isMissingLaunchChecklistTable(error)) {
      return NextResponse.json(
        { error: 'The launch checklist table does not exist yet — apply supabase/migrations/20261009120000_launch_checklist_items.sql' },
        { status: 503 },
      )
    }
    console.error('PUT /api/superadmin/tenants/[id]/launch-checklist/[itemKey]:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }

  const entry: LaunchChecklistEntry = {
    status: data.status,
    note: data.note,
    updatedBy: data.updated_by,
    updatedAt: data.updated_at,
  }
  return NextResponse.json(entry)
}
