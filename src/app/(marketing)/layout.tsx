import type { Metadata } from 'next'
import '../globals.css'
import { createServiceClient } from '@/lib/supabase/server'
import { computePrimaryForeground } from '@/lib/color-utils'

export const metadata: Metadata = {
  title: 'XmartMenu | Digital menus built for service',
  description:
    'Create a beautiful digital menu, generate a QR code, and start taking orders. No tech skills needed.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://xmartmenu.skale.club'),
  openGraph: {
    title: 'XmartMenu | Digital menus built for service',
    description:
      'Create a beautiful digital menu, generate a QR code, and start taking orders. No tech skills needed.',
    url: process.env.NEXT_PUBLIC_APP_URL || 'https://xmartmenu.skale.club',
    siteName: 'XmartMenu',
    locale: 'en_US',
    type: 'website',
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        alt: 'XmartMenu | Digital menus built for service',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'XmartMenu | Digital menus built for service',
    description:
      'Create a beautiful digital menu, generate a QR code, and start taking orders. No tech skills needed.',
    images: ['/opengraph-image'],
  },
}

export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const service = await createServiceClient()
  const { data: ps } = await service.from('platform_settings').select('cta_color').single()
  const primary = ps?.cta_color ?? '#EEFF00'
  const primaryFg = computePrimaryForeground(primary)

  return (
    <html lang="en">
      <body className="min-h-full bg-white">
        <style>{`:root{--primary:${primary};--primary-foreground:${primaryFg};}`}</style>
        {children}
      </body>
    </html>
  )
}
