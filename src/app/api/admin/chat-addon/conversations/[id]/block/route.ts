/**
 * POST /api/admin/chat-addon/conversations/[id]/block
 * Blocks the phone associated with a conversation and marks the conversation as blocked.
 */
import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (effective.role === 'store-staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()

  const { id } = await params
  const { reason } = (await request.json().catch(() => ({}))) as { reason?: string }

  const supabase = createServiceClient()
  const { data: convo } = await supabase
    .from('chat_conversations')
    .select('id, tenant_id, phone_hash')
    .eq('id', id)
    .eq('tenant_id', effective.tenantId)
    .maybeSingle()

  if (!convo) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await supabase.from('chat_blocked_phones').upsert(
    {
      tenant_id: effective.tenantId,
      phone_hash: convo.phone_hash,
      blocked_by: user?.id ?? null,
      reason: reason ?? null,
    },
    { onConflict: 'tenant_id,phone_hash' },
  )

  await supabase
    .from('chat_conversations')
    .update({ status: 'blocked' })
    .eq('tenant_id', effective.tenantId)
    .eq('phone_hash', convo.phone_hash)

  return NextResponse.json({ ok: true })
}
