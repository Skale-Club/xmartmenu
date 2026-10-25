export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { getChatAddonStatus } from '@/lib/chat-addon'
import { createServiceClient } from '@/lib/supabase/server'
import ChatAddonClient from './ChatAddonClient'

export default async function ChatAddonSettingsPage() {
  const effective = await getEffectiveTenant()
  if (!effective) redirect('/auth/login')
  if (effective.role === 'store-staff') redirect('/dashboard')

  const supabase = createServiceClient()
  const { data: settings } = await supabase
    .from('chat_addon_settings')
    .select('*')
    .eq('tenant_id', effective.tenantId)
    .maybeSingle()

  const status = await getChatAddonStatus(effective.tenantId)

  // Keys live in Settings › AI & billing now; never send the legacy columns out.
  const masked = settings ? { ...settings, openrouter_api_key: undefined, audio_api_key: undefined } : null

  return <ChatAddonClient initialSettings={masked} status={status} />
}
