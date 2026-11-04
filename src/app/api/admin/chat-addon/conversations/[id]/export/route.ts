/**
 * GET /api/admin/chat-addon/conversations/[id]/export
 * Downloads the full conversation as CSV (timestamp, role, content).
 */
import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { createServiceClient } from '@/lib/supabase/server'
import { withApi } from '@/lib/observability/with-api'
import { adminMenusOwned } from '@/lib/data/admin-menus'
import { adminChatContext, adminChatError } from '@/lib/admin/chat-context'
import { readOwnedAdminChatThread } from '@/lib/data/admin-chat-runtime'

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`
  return v
}

async function handleGET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (effective.role === 'store-staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  if (adminMenusOwned()) {
    try {
      const thread = await readOwnedAdminChatThread(await adminChatContext(effective), id)
      return csvResponse(id, thread.messages)
    } catch (error) { return adminChatError(error) }
  }
  const supabase = createServiceClient()

  const { data: convo } = await supabase
    .from('chat_conversations')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', effective.tenantId)
    .maybeSingle()
  if (!convo) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: messages } = await supabase
    .from('chat_messages')
    .select('role, content, created_at')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true })

  return csvResponse(id, messages ?? [])
}

function csvResponse(id: string, messages: Array<Record<string, unknown>>) {
  const rows = ['timestamp,role,content']
  for (const m of messages) rows.push(`${csvEscape(String(m.created_at))},${csvEscape(String(m.role))},${csvEscape(String(m.content ?? ''))}`)
  const csv = rows.join('\n')

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="conversation-${id.slice(0, 8)}.csv"`,
    },
  })
}

export const GET = withApi('GET /api/admin/chat-addon/conversations/[id]/export', handleGET)
