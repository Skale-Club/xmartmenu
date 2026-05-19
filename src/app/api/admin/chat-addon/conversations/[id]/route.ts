/**
 * GET /api/admin/chat-addon/conversations/[id]
 * Returns the full message thread for a conversation owned by the current tenant.
 */
import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (effective.role === 'store-staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const supabase = createServiceClient()

  const { data: convo } = await supabase
    .from('chat_conversations')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', effective.tenantId)
    .maybeSingle()

  if (!convo) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

  const { data: messages } = await supabase
    .from('chat_messages')
    .select('id, role, content, created_at, has_audio, tokens_used')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true })

  return NextResponse.json({ conversation: convo, messages: messages ?? [] })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (effective.role === 'store-staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await params
  const body = await request.json() as { admin_note?: string }
  const supabase = createServiceClient()

  const { error } = await supabase
    .from('chat_conversations')
    .update({ admin_note: body.admin_note ?? null })
    .eq('id', id)
    .eq('tenant_id', effective.tenantId)

  if (error) return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
