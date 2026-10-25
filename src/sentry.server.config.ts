import * as Sentry from '@sentry/nextjs'
import { scrubEvent } from '@/lib/observability/sentry-scrub'

// Server-side Sentry (Node). Inert unless SENTRY_DSN is set. Errors from
// routes wrapped with withApi() carry request_id / route / tenant_id tags, the
// same id as the logs and the x-request-id response header.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: !!process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  release: process.env.NEXT_PUBLIC_RELEASE || undefined,
  // Lower in prod to control quota; raise temporarily when debugging.
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  sendDefaultPii: false,
  beforeSend: event => scrubEvent(event),
  initialScope: { tags: { service: 'xmartmenu', runtime: 'node' } },
})
