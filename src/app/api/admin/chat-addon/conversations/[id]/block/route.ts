/**
 * POST /api/admin/chat-addon/conversations/[id]/block
 * Blocks the phone associated with a conversation and marks the conversation as blocked.
 */
import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { withApi } from '@/lib/observability/with-api'
import { adminMenusOwned } from '@/lib/data/admin-menus'
import { adminChatContext, adminChatError } from '@/lib/admin/chat-context'
import { blockOwnedAdminChatPhone } from '@/lib/data/admin-chat-runtime'
import { readNativeAnalyticsBody } from '@/lib/data/public-analytics'

async function handlePOST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (effective.role === 'store-staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (adminMenusOwned()) {
    try {
      const { id } = await params
      let body: unknown
      try { body = JSON.parse(await readNativeAnalyticsBody(request)) } catch (error) { if (error instanceof SyntaxError) body = {}; else throw error }
      return NextResponse.json(await blockOwnedAdminChatPhone(await adminChatContext(effective), id, body))
    } catch (error) { return adminChatError(error) }
  }

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

export const POST = withApi('POST /api/admin/chat-addon/conversations/[id]/block', handlePOST)
