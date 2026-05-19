export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { getChatAddonStatus } from '@/lib/chat-addon'
import { createServiceClient } from '@/lib/supabase/server'
import { maskApiKey, decryptApiKey } from '@/lib/crypto'
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

  const masked = settings ? {
    ...settings,
    openrouter_api_key: settings.openrouter_api_key
      ? (() => { try { return maskApiKey(decryptApiKey(settings.openrouter_api_key)) } catch { return '••••' } })()
      : '',
    audio_api_key: settings.audio_api_key
      ? (() => { try { return maskApiKey(decryptApiKey(settings.audio_api_key)) } catch { return '••••' } })()
      : '',
  } : null

  return <ChatAddonClient initialSettings={masked} status={status} />
}
