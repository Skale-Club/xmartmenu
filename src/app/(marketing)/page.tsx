export const dynamic = 'force-static'

import type { WithContext, Organization, SoftwareApplication } from 'schema-dts'
import ClientLandingPage from './ClientPage'

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  const organization: WithContext<Organization> = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'XmartMenu',
    url: 'https://xmartmenu.skale.club',
    description: 'Digital menu platform for restaurants via QR code',
    sameAs: [],
  }

  const software: WithContext<SoftwareApplication> = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'XmartMenu',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'BRL',
      description: 'Grátis durante o beta',
    },
  }

  return (
    <>
      {/* JSON-LD structured data — per SEO-03. Inline dangerouslySetInnerHTML only.
          Do NOT use the Script component for JSON-LD (causes RSC hydration duplicates in React 19).
          NEVER move this to layout.tsx (would appear on all tenant pages). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(organization).replace(/</g, '\\u003c'),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(software).replace(/</g, '\\u003c'),
        }}
      />
      <ClientLandingPage />
    </>
  )
}
