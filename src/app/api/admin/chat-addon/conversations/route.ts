/**
 * GET /api/admin/chat-addon/conversations
 * List conversations for the current tenant with filters + pagination.
 * Query: ?status=active|blocked|all&page=1&page_size=50
 */
import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (effective.role === 'store-staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = new URL(request.url)
  const status = url.searchParams.get('status') ?? 'all'
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('page_size')) || 50))
  const offset = (page - 1) * pageSize

  const supabase = createServiceClient()
  let query = supabase
    .from('chat_conversations')
    .select('id, phone_hash, started_at, last_message_at, message_count, status, admin_note', { count: 'exact' })
    .eq('tenant_id', effective.tenantId)
    .order('last_message_at', { ascending: false })
    .range(offset, offset + pageSize - 1)

  if (status === 'active' || status === 'blocked') {
    query = query.eq('status', status)
  }

  const { data, count } = await query

  return NextResponse.json({
    conversations: data ?? [],
    total: count ?? 0,
    page,
    page_size: pageSize,
  })
}
