'use client'

import { BRAND_PRIMARY, BRAND_BASE } from '@/lib/brand'
import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log server-visibly for debugging; never surfaced to the user.
    console.error('GlobalError boundary caught:', error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0f0f0f',
          color: BRAND_BASE,
          fontFamily:
            'Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
          padding: '24px',
        }}
      >
        <div style={{ maxWidth: '420px', textAlign: 'center' }}>
          <p
            style={{
              margin: '0 0 8px',
              fontSize: '14px',
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: BRAND_BASE,
            }}
          >
            Xprout
          </p>
          <h1 style={{ margin: '0 0 12px', fontSize: '24px', fontWeight: 700 }}>
            Something went wrong
          </h1>
          <p
            style={{
              margin: '0 0 24px',
              fontSize: '15px',
              lineHeight: 1.5,
              color: '#a3a3a3',
            }}
          >
            An unexpected error occurred. Please try again — if the problem
            persists, contact support.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              appearance: 'none',
              border: 'none',
              borderRadius: '8px',
              backgroundColor: BRAND_PRIMARY,
              color: BRAND_BASE,
              fontSize: '15px',
              fontWeight: 600,
              padding: '12px 24px',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
