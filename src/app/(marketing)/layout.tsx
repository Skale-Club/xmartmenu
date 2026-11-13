import { BRAND_NAME, BRAND_URL, BRAND_PRIMARY } from '@/lib/brand'
import type { Metadata } from 'next'
import '../globals.css'
import { createServiceClient } from '@/lib/supabase/server'
import { computePrimaryForeground, safeCssColor } from '@/lib/color-utils'
import { platformSettingsOwned } from '@/lib/data/platform-settings'

interface MarketingSettings {
  app_name: string | null; seo_title: string | null; seo_description: string | null
  cta_color: string | null; favicon_url: string | null; twitter_handle: string | null
}

export const revalidate = 60

// Single DB call shared by generateMetadata() and MarketingLayout().
// Avoids two platform_settings round-trips per request (see Phase 44 research Pitfall 5).
async function getPlatformSettings(): Promise<MarketingSettings | null> {
  try {
    if (platformSettingsOwned()) {
      // Own PostgreSQL only: a failure falls back to the defaults, never to Supabase.
      const { readOwnedPlatformSettings } = await import('@/lib/data/platform-settings-runtime')
      return await readOwnedPlatformSettings(['app_name', 'seo_title', 'seo_description', 'cta_color', 'favicon_url', 'twitter_handle']) as MarketingSettings | null
    }
    const service = createServiceClient()
    const { data } = await service
      .from('platform_settings')
      .select('app_name, seo_title, seo_description, cta_color, favicon_url, twitter_handle')
      .single()
    return data
  } catch {
    return null
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const ps = await getPlatformSettings()

  const appName = ps?.app_name ?? BRAND_NAME
  const title = ps?.seo_title ?? `${appName} | Digital menus built for service`
  const description =
    ps?.seo_description ??
    'Create a beautiful digital menu, generate a QR code, and start taking orders. No tech skills needed.'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || BRAND_URL

  return {
    // Absolute: this title already carries the brand, so the root layout's
    // '%s | Xprout' template must not append it a second time.
    title: { absolute: title },
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
      ...(ps?.twitter_handle ? { site: ps.twitter_handle, creator: ps.twitter_handle } : {}),
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
  const primary = ps?.cta_color ?? BRAND_PRIMARY
  const primaryFg = computePrimaryForeground(primary)

  return (
    <html lang="en">
      <body className="min-h-full bg-white no-text-cursor">
        <style>{`:root{--primary:${safeCssColor(primary)};--primary-foreground:${primaryFg};}`}</style>
        {children}
      </body>
    </html>
  )
}
