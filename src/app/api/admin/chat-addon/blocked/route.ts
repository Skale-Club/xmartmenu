/**
 * GET    /api/admin/chat-addon/blocked        — list blocked phones
 * DELETE /api/admin/chat-addon/blocked?id=... — unblock a phone
 */
import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { createServiceClient } from '@/lib/supabase/server'
import { withApi } from '@/lib/observability/with-api'
import { adminMenusOwned } from '@/lib/data/admin-menus'
import { adminChatContext, adminChatError } from '@/lib/admin/chat-context'
import { readOwnedAdminChatBlocked, unblockOwnedAdminChatPhone } from '@/lib/data/admin-chat-runtime'

async function handleGET() {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (effective.role === 'store-staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (adminMenusOwned()) {
    try { return NextResponse.json(await readOwnedAdminChatBlocked(await adminChatContext(effective))) }
    catch (error) { return adminChatError(error) }
  }

  const supabase = createServiceClient()
  const { data } = await supabase
    .from('chat_blocked_phones')
    .select('id, phone_hash, blocked_at, reason')
    .eq('tenant_id', effective.tenantId)
    .order('blocked_at', { ascending: false })

  return NextResponse.json({ blocked: data ?? [] })
}

async function handleDELETE(request: Request) {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (effective.role === 'store-staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const url = new URL(request.url)
  const id = url.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  if (adminMenusOwned()) {
    try { return NextResponse.json(await unblockOwnedAdminChatPhone(await adminChatContext(effective), id)) }
    catch (error) { return adminChatError(error) }
  }

  const supabase = createServiceClient()
  const { data: row } = await supabase
    .from('chat_blocked_phones')
    .select('phone_hash')
    .eq('id', id)
    .eq('tenant_id', effective.tenantId)
    .maybeSingle()

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await supabase.from('chat_blocked_phones').delete().eq('id', id).eq('tenant_id', effective.tenantId)
  // Reactivate any conversations from that phone
  await supabase
    .from('chat_conversations')
    .update({ status: 'active' })
    .eq('tenant_id', effective.tenantId)
    .eq('phone_hash', row.phone_hash)

  return NextResponse.json({ ok: true })
}

export const GET = withApi('GET /api/admin/chat-addon/blocked', handleGET)
export const DELETE = withApi('DELETE /api/admin/chat-addon/blocked', handleDELETE)
