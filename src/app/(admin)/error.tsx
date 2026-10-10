'use client'

import { useEffect } from 'react'
import RouteError from '@/components/ui/RouteError'

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('admin.route_error', error) }, [error])
  return <RouteError reset={reset} />
}
