export const revalidate = 60

import type { WithContext, Organization, SoftwareApplication } from 'schema-dts'
import { createServiceClient } from '@/lib/supabase/server'
import ClientLandingPage from './ClientPage'

async function getPlatformSettings() {
  try {
    const service = createServiceClient()
    const { data } = await service.from('platform_settings').select('landing').single()
    return data?.landing ?? null
  } catch {
    return null
  }
}

export default async function LandingPage() {
  const platformLanding = await getPlatformSettings()

  const organization: WithContext<Organization> = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'XmartMenu',
    url: 'https://xmartmenu.com',
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
      priceCurrency: 'USD',
      description: 'Free during beta',
    },
  }

  return (
    <>
      {/* JSON-LD structured data. Inline dangerouslySetInnerHTML only.
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
      <ClientLandingPage platformLanding={platformLanding} />
    </>
  )
}
