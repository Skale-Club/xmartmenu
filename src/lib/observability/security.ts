import * as Sentry from '@sentry/nextjs'

/**
 * Record a security-relevant event (auth failure, authz denial, webhook
 * signature failure, suspicious payload) so it surfaces in Sentry with alerting.
 * No-ops safely when Sentry has no DSN configured. (S09 — detection.)
 */
export function captureSecurityEvent(
  message: string,
  context?: Record<string, unknown>,
): void {
  Sentry.captureMessage(message, {
    level: 'warning',
    tags: { kind: 'security' },
    extra: context,
  })
}
