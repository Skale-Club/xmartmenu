'use client'

import { useEffect } from 'react'
import RouteError from '@/components/ui/RouteError'

export default function PublicError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('public.route_error', error) }, [error])
  return <RouteError reset={reset} title="This page couldn't load" />
}
