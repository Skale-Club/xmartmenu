export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import AiSettingsClient from './AiSettingsClient'

export default async function AiSettingsPage() {
  const effective = await getEffectiveTenant()
  if (!effective) redirect('/auth/login')
  if (effective.role === 'store-staff') redirect('/dashboard')
  return <AiSettingsClient />
}
