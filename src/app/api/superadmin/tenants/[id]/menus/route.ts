import { createServiceClient } from '@/lib/supabase/server'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import { NextResponse } from 'next/server'
import { withApi } from '@/lib/observability/with-api'
import { log } from '@/lib/observability/log'

interface Props { params: Promise<{ id: string }> }

async function handleGET(_req: Request, { params }: Props) {
  const { id: tenantId } = await params
  if (!await assertSuperadmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = await createServiceClient()
  const { data, error } = await service
    .from('menus')
    .select('id, name, slug, language, is_active, position, created_at')
    .eq('tenant_id', tenantId)
    .order('position')

  if (error) {
    log.error('GET /api/superadmin/tenants/[id]/menus', { err: error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
  return NextResponse.json(data ?? [])
}

export const GET = withApi('GET /api/superadmin/tenants/[id]/menus', handleGET)
