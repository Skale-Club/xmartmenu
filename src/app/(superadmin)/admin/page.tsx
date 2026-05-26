export const dynamic = 'force-dynamic'

import { createServiceClient } from '@/lib/supabase/server'
import SettingsClient from './SettingsClient'

export default async function SettingsPage() {
  const service = await createServiceClient()
  const { data: settings } = await service.from('platform_settings').select('*').single()
  return <SettingsClient settings={settings} />
}
