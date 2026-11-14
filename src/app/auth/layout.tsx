import { platformLogoUrl } from '@/lib/platform-brand'
import { createServiceClient } from '@/lib/supabase/server'
import { ownedAuthSelected } from '@/lib/auth/owned-principal'
import { getOwnedShellPlatform } from '@/lib/auth/owned-shell-runtime'

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const ps = ownedAuthSelected() ? await getOwnedShellPlatform() : (await createServiceClient().from('platform_settings').select('favicon_url').single()).data
  const logoUrl = platformLogoUrl(ps?.favicon_url)
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: `window.__LOGO_URL__=${JSON.stringify(logoUrl)}` }} />
      {children}
    </>
  )
}
