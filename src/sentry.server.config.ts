import * as Sentry from '@sentry/nextjs'

// Server-side Sentry init. Inert unless SENTRY_DSN is set (S09 observability).
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: !!process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  // Lower in prod to control quota; raise temporarily when debugging.
})
