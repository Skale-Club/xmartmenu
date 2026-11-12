'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// Stub: the real questionnaire UI replaces this file.
export default function AccessRequestFlow({ teamWhatsApp }: { teamWhatsApp: string | null }) {
  const router = useRouter()
  useEffect(() => {
    let cancelled = false
    fetch('/api/access-request', { cache: 'no-store' })
      .then(res => (res.ok ? res.json() : null))
      .then(state => { if (!cancelled && state?.status === 'has_restaurant') router.replace('/dashboard') })
      .catch(() => {})
    return () => { cancelled = true }
  }, [router])
  return <div data-testid="access-request-flow" data-team-whatsapp={teamWhatsApp ?? ''} />
}
