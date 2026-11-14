import { BRAND_NAME, BRAND_URL } from '@/lib/brand'
import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { getPlatformAppearance } from '@/lib/data/platform-appearance-runtime'
import { platformColors } from '@/lib/platform-colors'
import ServiceWorkerRegistrar from '@/components/ServiceWorkerRegistrar'
import { platformMetadataIcons } from '@/lib/platform-metadata'
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
    themeColor: platformColors(ps?.cta_color).primary,
    viewportFit: 'cover',
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const ps = await getPlatformAppearance()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || BRAND_URL
  return {
    title: {
      template: `%s | ${BRAND_NAME}`,
      default: `${BRAND_NAME} | Digital menu for restaurants`,
    },
    description: 'A digital menu platform built for restaurant service, QR code ordering, and menu operations.',
    metadataBase: new URL(appUrl),
    applicationName: BRAND_NAME,
    appleWebApp: {
      capable: true,
      statusBarStyle: 'default',
      title: BRAND_NAME,
    },
    icons: platformMetadataIcons(ps?.favicon_url),
    openGraph: {
      type: 'website',
      locale: 'en_US',
      siteName: BRAND_NAME,
      images: [{ url: '/opengraph-image?v=xprout-v1', width: 1200, height: 630, alt: BRAND_NAME }],
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
  const { primary, onPrimary } = platformColors(ps?.cta_color)

  return (
    <html lang="en" className={`h-full antialiased ${inter.variable}`}>
      <head>
        <style>{`:root{--primary:${primary};--primary-foreground:${onPrimary};}`}</style>
      </head>
      <body className={`${inter.className} min-h-full`}>
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  )
}
