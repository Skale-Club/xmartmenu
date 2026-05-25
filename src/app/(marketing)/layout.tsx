import type { Metadata } from 'next'
import '../globals.css'
import { createServiceClient } from '@/lib/supabase/server'
import { computePrimaryForeground } from '@/lib/color-utils'

export const revalidate = 60

// Single DB call shared by generateMetadata() and MarketingLayout().
// Avoids two platform_settings round-trips per request (see Phase 44 research Pitfall 5).
async function getPlatformSettings() {
  try {
    const service = createServiceClient()
    const { data } = await service
      .from('platform_settings')
      .select('app_name, seo_title, seo_description, cta_color, favicon_url')
      .single()
    return data
  } catch {
    return null
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const ps = await getPlatformSettings()

  const appName = ps?.app_name ?? 'XmartMenu'
  const title = ps?.seo_title ?? `${appName} | Digital menus built for service`
  const description =
    ps?.seo_description ??
    'Create a beautiful digital menu, generate a QR code, and start taking orders. No tech skills needed.'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://xmartmenu.skale.club'

  return {
    title,
    description,
    metadataBase: new URL(appUrl),
    openGraph: {
      title,
      description,
      url: appUrl,
      siteName: appName,
      locale: 'en_US',
      type: 'website',
      images: [
        {
          url: '/opengraph-image',
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ['/opengraph-image'],
    },
    icons: ps?.favicon_url ? { icon: ps.favicon_url, shortcut: ps.favicon_url } : undefined,
  }
}

export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const ps = await getPlatformSettings()
  const primary = ps?.cta_color ?? '#F52323'
  const primaryFg = computePrimaryForeground(primary)

  return (
    <html lang="en">
      <body className="min-h-full bg-white no-text-cursor">
        <style>{`:root{--primary:${primary};--primary-foreground:${primaryFg};}`}</style>
        {children}
      </body>
    </html>
  )
}
