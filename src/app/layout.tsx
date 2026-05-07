import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  preload: true,
})

export const metadata: Metadata = {
  title: {
    template: '%s | XmartMenu',
    default: 'XmartMenu — Cardápio digital para restaurantes',
  },
  description: 'Crie seu cardápio digital via QR Code em minutos. Sem design, sem desenvolvedor.',
  metadataBase: new URL('https://xmartmenu.skale.club'),
  openGraph: {
    type: 'website',
    locale: 'pt_BR',
    alternateLocale: 'en_US',
    siteName: 'XmartMenu',
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
    <html lang="pt-BR" className="h-full antialiased">
      <body className={`${inter.className} min-h-full`}>
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
