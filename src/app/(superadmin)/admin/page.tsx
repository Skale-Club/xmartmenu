export const dynamic = 'force-dynamic'

import { createServiceClient } from '@/lib/supabase/server'
import SettingsClient from './SettingsClient'
import { platformSettingsOwned } from '@/lib/data/platform-settings'

export default async function SettingsPage() {
  if (platformSettingsOwned()) {
    // The (superadmin) layout has authenticated the role; a read failure surfaces
    // as the error boundary, never as a silent read of the stale Supabase copy.
    const { readOwnedPlatformSettings } = await import('@/lib/data/platform-settings-runtime')
    return <SettingsClient settings={await readOwnedPlatformSettings('*')} />
  }
  const service = await createServiceClient()
  const { data: settings } = await service.from('platform_settings').select('*').single()
  return <SettingsClient settings={settings} />
}
