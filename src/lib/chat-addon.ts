/**
 * SEED-024 helpers: addon status check and rate limiter. The assistant itself
 * (menu context, history, addToCart) lives in chat-agent.ts.
 *
 * The chat addon is "available" when the tenant's plan has chat_addon_available=true
 * AND the tenant has chat_addon_active=true on their subscription. A superadmin can
 * override via tenant_subscriptions.chat_addon_override (TRUE = force-on, FALSE = force-off).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/server'

export interface ChatAddonStatus {
  available: boolean       // plan permits it
  active: boolean          // subscription paid AND admin enabled
  enabled: boolean         // chat_addon_settings.enabled
  overrideApplied: boolean // superadmin override is in effect
}

export async function getChatAddonStatus(tenantId: string): Promise<ChatAddonStatus> {
  const supabase = createServiceClient()
  const [{ data: sub }, { data: settings }] = await Promise.all([
    supabase
      .from('tenant_subscriptions')
      .select('chat_addon_active, chat_addon_override, plan_id, plans(chat_addon_available)')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    supabase
      .from('chat_addon_settings')
      .select('enabled')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
  ])

  const planAvailable = (sub?.plans as { chat_addon_available?: boolean } | null)?.chat_addon_available ?? false
  const override = (sub as any)?.chat_addon_override as boolean | null | undefined
  const subActive = sub?.chat_addon_active ?? false
  const enabled = settings?.enabled ?? false

  let active = planAvailable && subActive
  let overrideApplied = false
  if (override === true) { active = true; overrideApplied = true }
  if (override === false) { active = false; overrideApplied = true }

  return {
    available: planAvailable || override === true,
    active,
    enabled: active && enabled,
    overrideApplied,
  }
}

/**
 * Counts user messages in the last 24h for a (tenant, phone_hash) pair.
 * Used to enforce rate_limit_per_phone_per_day.
 */
export async function countMessagesLast24h(
  supabase: SupabaseClient,
  tenantId: string,
  phoneHash: string,
): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count } = await supabase
    .from('chat_messages')
    .select('id, conversation:chat_conversations!inner(tenant_id, phone_hash)', { count: 'exact', head: true })
    .eq('role', 'user')
    .gte('created_at', since)
    .eq('chat_conversations.tenant_id', tenantId)
    .eq('chat_conversations.phone_hash', phoneHash)
  return count ?? 0
}
