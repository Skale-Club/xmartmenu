import { Suspense } from 'react'
import type { Metadata } from 'next'
import ConsentClient from './ConsentClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Autorizar acesso',
  robots: { index: false, follow: false },
}

/**
 * OAuth 2.1 consent screen for the Supabase-hosted authorization server.
 * Supabase redirects the user here (?authorization_id=…) during the MCP OAuth
 * flow; the client component approves/denies via supabase.auth.oauth.*.
 */
export default function OAuthConsentPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-950" />}>
      <ConsentClient />
    </Suspense>
  )
}
