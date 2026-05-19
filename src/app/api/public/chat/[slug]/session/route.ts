/**
 * Public chat session endpoint (phone gate).
 *
 * Accepts a phone number, hashes it scoped to the tenant, and returns an
 * existing or newly-created conversation_id for today. Refuses if the
 * phone is in chat_blocked_phones for this tenant.
 */
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { hashPhone } from '@/lib/crypto'
import { getChatAddonStatus } from '@/lib/chat-addon'

export const runtime = 'nodejs'

interface Body { phone: string }

function validatePhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '')
  return digits.length >= 8 && digits.length <= 15
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { phone } = (await request.json()) as Body
  if (!phone || !validatePhone(phone)) {
    return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle()

  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  const status = await getChatAddonStatus(tenant.id)
  if (!status.enabled) return NextResponse.json({ error: 'Chat addon not enabled' }, { status: 403 })

  const phoneHash = hashPhone(phone.replace(/\D/g, ''), tenant.id)

  // Blocklist check
  const { data: blocked } = await supabase
    .from('chat_blocked_phones')
    .select('id')
    .eq('tenant_id', tenant.id)
    .eq('phone_hash', phoneHash)
    .maybeSingle()
  if (blocked) {
    return NextResponse.json({ error: 'This number is not allowed to use the assistant' }, { status: 403 })
  }

  // One conversation per phone per UTC day
  const startOfDay = new Date()
  startOfDay.setUTCHours(0, 0, 0, 0)

  const { data: existing } = await supabase
    .from('chat_conversations')
    .select('id, message_count')
    .eq('tenant_id', tenant.id)
    .eq('phone_hash', phoneHash)
    .gte('started_at', startOfDay.toISOString())
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let conversationId = existing?.id ?? null
  if (!conversationId) {
    const { data: inserted, error } = await supabase
      .from('chat_conversations')
      .insert({ tenant_id: tenant.id, phone_hash: phoneHash })
      .select('id')
      .single()
    if (error || !inserted) {
      console.error('chat_conversations.insert_error', error)
      return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 })
    }
    conversationId = inserted.id
  }

  // Rate limit info
  const { data: settings } = await supabase
    .from('chat_addon_settings')
    .select('rate_limit_per_phone_per_day')
    .eq('tenant_id', tenant.id)
    .maybeSingle()

  return NextResponse.json({
    conversation_id: conversationId,
    rate_limit: settings?.rate_limit_per_phone_per_day ?? 30,
    messages_today: existing?.message_count ?? 0,
  })
}
