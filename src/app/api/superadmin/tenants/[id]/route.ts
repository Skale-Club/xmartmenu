import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isSuperadminRequest } from '@/lib/superadmin-auth'
import { NextResponse } from 'next/server'

async function assertSuperadmin() {
  const allowed = await isSuperadminRequest()
  if (!allowed) return null
  return createClient()
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await assertSuperadmin()
  if (!supabase) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const allowed = ['is_active', 'plan', 'name']
  const update: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) update[key] = body[key]
  }

  const { data, error } = await supabase.from('tenants').update(update).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await assertSuperadmin()
  if (!supabase) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = await createServiceClient()

  // Busca usuários do tenant para deletar do Auth
  const { data: profiles } = await service.from('profiles').select('id').eq('tenant_id', id)
  if (profiles) {
    for (const p of profiles) {
      await service.auth.admin.deleteUser(p.id)
    }
  }

  // Deleta scan_events (sem ON DELETE CASCADE no banco)
  await service.from('scan_events').delete().eq('tenant_id', id)

  // Deleta tenant (cascade deleta categorias, produtos, etc.)
  const { error } = await service.from('tenants').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
