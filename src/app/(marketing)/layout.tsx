import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import '../globals.css'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  preload: true,
})

export const metadata: Metadata = {
  title: 'XmartMenu — Your restaurant menu, online in minutes',
  description:
    'Create a beautiful digital menu, generate a QR code, and start taking orders — no tech skills needed.',
  metadataBase: new URL('https://xmartmenu.skale.club'),
  openGraph: {
    title: 'XmartMenu — Your restaurant menu, online in minutes',
    description:
      'Create a beautiful digital menu, generate a QR code, and start taking orders — no tech skills needed.',
    url: 'https://xmartmenu.skale.club',
    siteName: 'XmartMenu',
    locale: 'en_US',
    type: 'website',
    images: [
      {
        url: '/opengraph-image',
        width: 1200,
        height: 630,
        alt: 'XmartMenu — Your restaurant menu, online in minutes',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'XmartMenu — Your restaurant menu, online in minutes',
    description:
      'Create a beautiful digital menu, generate a QR code, and start taking orders — no tech skills needed.',
    images: ['/opengraph-image'],
  },
}

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className={`${inter.className} min-h-full bg-white`}>
        {children}
      </body>
    </html>
  )
}
