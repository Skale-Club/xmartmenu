'use client'

import { useEffect } from 'react'
import RouteError from '@/components/ui/RouteError'

export default function SuperadminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('superadmin.route_error', error) }, [error])
  return <RouteError reset={reset} />
}
