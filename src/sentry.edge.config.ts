import * as Sentry from '@sentry/nextjs'
import { scrubEvent } from '@/lib/observability/sentry-scrub'

// Edge-runtime Sentry (middleware). Inert unless SENTRY_DSN is set.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: !!process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  release: process.env.NEXT_PUBLIC_RELEASE || undefined,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  sendDefaultPii: false,
  beforeSend: event => scrubEvent(event),
  initialScope: { tags: { service: 'xmartmenu', runtime: 'edge' } },
})
