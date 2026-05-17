'use client'

import { useEffect } from 'react'

/**
 * Tiny client island that fires a POST /api/public/scan once on mount.
 * Lives in a client component (instead of the ISR-cached server page) so
 * each visit is actually recorded — see round-2 P0-08.
 *
 * The fetch is fire-and-forget and intentionally swallows errors so a
 * down analytics path never blocks menu rendering.
 */
export default function ScanRecorder({ tenantId }: { tenantId: string }) {
  useEffect(() => {
    const ctrl = new AbortController()
    fetch('/api/public/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id: tenantId }),
      signal: ctrl.signal,
      keepalive: true,
    }).catch(() => {})
    return () => ctrl.abort()
  }, [tenantId])
  return null
}
