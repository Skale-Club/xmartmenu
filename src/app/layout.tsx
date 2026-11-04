import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { getPlatformAppearance } from '@/lib/data/platform-appearance-runtime'
import { computePrimaryForeground, safeCssColor } from '@/lib/color-utils'
import ServiceWorkerRegistrar from '@/components/ServiceWorkerRegistrar'
import InstallPrompt from '@/components/InstallPrompt'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  preload: true,
  variable: '--font-inter',
})

export async function generateViewport(): Promise<Viewport> {
  const ps = await getPlatformAppearance()
  return {
    themeColor: ps?.cta_color ?? '#F52323',
    viewportFit: 'cover',
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const ps = await getPlatformAppearance()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://xmartmenu.skale.club'
  return {
    title: {
      template: '%s | XmartMenu',
      default: 'XmartMenu | Digital menu for restaurants',
    },
    description: 'A digital menu platform built for restaurant service, QR code ordering, and menu operations.',
    metadataBase: new URL(appUrl),
    applicationName: 'XmartMenu',
    appleWebApp: {
      capable: true,
      statusBarStyle: 'default',
      title: 'XmartMenu',
    },
    icons: ps?.favicon_url
      ? { icon: ps.favicon_url, shortcut: ps.favicon_url, apple: '/icons/apple-touch-icon.png' }
      : { apple: '/icons/apple-touch-icon.png' },
    openGraph: {
      type: 'website',
      locale: 'en_US',
      siteName: 'XmartMenu',
      images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: 'XmartMenu' }],
    },
    twitter: { card: 'summary_large_image' },
  }
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const ps = await getPlatformAppearance()
  const primary = ps?.cta_color ?? '#F52323'
  const primaryFg = computePrimaryForeground(primary)

  return (
    <html lang="en" className={`h-full antialiased ${inter.variable}`}>
      <head>
        <style>{`:root{--primary:${safeCssColor(primary)};--primary-foreground:${primaryFg};}`}</style>
      </head>
      <body className={`${inter.className} min-h-full`}>
        {children}
        <ServiceWorkerRegistrar />
        <InstallPrompt />
      </body>
    </html>
  )
}
