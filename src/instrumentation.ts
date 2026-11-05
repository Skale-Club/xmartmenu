import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config')
    // Owned mode refuses to boot without S3 storage, a valid ADMIN_MENUS target and one shared database.
    const { assertOwnedModeStartup } = await import('./lib/data/owned-startup')
    assertOwnedModeStartup()
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config')
  }
}

// Captures errors thrown in nested React Server Components / route handlers.
export const onRequestError = Sentry.captureRequestError
