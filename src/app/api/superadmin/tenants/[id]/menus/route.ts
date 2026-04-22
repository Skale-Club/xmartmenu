import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

interface Props { params: Promise<{ id: string }> }

async function assertSuperadmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'superadmin' ? true : null
}

export async function GET(_req: Request, { params }: Props) {
  const { id: tenantId } = await params
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = await createServiceClient()
  const { data, error } = await service
    .from('menus')
    .select('id, name, slug, language, is_active, position, created_at')
    .eq('tenant_id', tenantId)
    .order('position')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
