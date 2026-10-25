import * as Sentry from '@sentry/nextjs'
import { scrubEvent } from '@/lib/observability/sentry-scrub'

// Browser Sentry. Inert unless NEXT_PUBLIC_SENTRY_DSN is set. Same release as
// the server (the build's git sha), so a front-end error and the server logs of
// the same deploy line up.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  release: process.env.NEXT_PUBLIC_RELEASE || undefined,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  beforeSend: event => scrubEvent(event),
  initialScope: { tags: { service: 'xmartmenu', runtime: 'browser' } },
})

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
