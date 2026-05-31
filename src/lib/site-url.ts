/**
 * Resolve the public-facing origin for server-side redirects.
 *
 * Behind a reverse proxy (Coolify/Traefik/Docker) the Next.js standalone
 * server binds to HOSTNAME=0.0.0.0:3000, so `new URL(request.url).origin`
 * resolves to `http(s)://0.0.0.0:3000` instead of the real domain. That
 * broke OAuth redirects (login landed on https://0.0.0.0:3000/overview).
 *
 * Resolution order:
 *   1. x-forwarded-host / x-forwarded-proto headers (set by the proxy)
 *   2. NEXT_PUBLIC_APP_URL env (explicit override)
 *   3. the request's own origin (local dev / no proxy)
 *
 * Any candidate resolving to 0.0.0.0 is rejected and we fall through.
 */
export function getRequestOrigin(request: Request): string {
  const isBadHost = (host: string | null | undefined) =>
    !host || host.startsWith('0.0.0.0') || host.startsWith('[::]')

  const forwardedHost = request.headers.get('x-forwarded-host')
  if (!isBadHost(forwardedHost)) {
    const proto =
      request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https'
    return `${proto}://${forwardedHost}`
  }

  const envUrl = process.env.NEXT_PUBLIC_APP_URL
  if (envUrl && !envUrl.includes('0.0.0.0')) {
    return envUrl.replace(/\/+$/, '')
  }

  return new URL(request.url).origin
}
