export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { getChatAddonStatus } from '@/lib/chat-addon'
import ChatInboxClient from './ChatInboxClient'

export default async function ChatInboxPage() {
  const effective = await getEffectiveTenant()
  if (!effective) redirect('/auth/login')
  if (effective.role === 'store-staff') redirect('/dashboard')

  const status = await getChatAddonStatus(effective.tenantId)
  if (!status.available) redirect('/settings/chat')

  return <ChatInboxClient />
}
