import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  preload: true,
  variable: '--font-inter',
})

export const metadata: Metadata = {
  title: {
    template: '%s | XmartMenu',
    default: 'XmartMenu | Digital menu for restaurants',
  },
  description: 'A digital menu platform built for restaurant service, QR code ordering, and menu operations.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://xmartmenu.skale.club'),
  openGraph: {
    type: 'website',
    locale: 'en_US',
    siteName: 'XmartMenu',
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        alt: 'XmartMenu',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`h-full antialiased ${inter.variable}`}>
      <body className={`${inter.className} min-h-full`}>
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
