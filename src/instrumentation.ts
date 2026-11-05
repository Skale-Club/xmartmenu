import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
    // Refuse to boot in owned mode without S3 storage (no silent Supabase fallback).
    const { assertOwnedModeStorage } = await import('./lib/data/owned-mode')
    assertOwnedModeStorage()
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

// Captures errors thrown in nested React Server Components / route handlers.
export const onRequestError = Sentry.captureRequestError
