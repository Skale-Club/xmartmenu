import { createServiceClient } from '@/lib/supabase/server'

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const service = createServiceClient()
  const { data: ps } = await service.from('platform_settings').select('favicon_url').single()
  const logoUrl = ps?.favicon_url ?? '/icon.png'
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: `window.__LOGO_URL__=${JSON.stringify(logoUrl)}` }} />
      {children}
    </>
  )
}
