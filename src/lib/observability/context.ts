/**
 * Per-request context for logs, Sentry and audit attribution (Node runtime).
 *
 * withApi() opens it for an API route; getEffectiveTenant() and
 * assertSuperadmin() fill in who is acting. Outside a wrapped request every
 * call here is a harmless no-op.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import * as Sentry from '@sentry/nextjs'

export interface RequestContext {
  requestId: string
  route?: string
  method?: string
  actorId?: string
  tenantId?: string
  role?: string
}

// One store per process: Next.js may bundle this module more than once (route
// handlers, server components, instrumentation), and every copy must read and
// write the same context — otherwise withApi() opens one store while the
// Supabase client reads another.
const globalStore = globalThis as { __xmartmenuRequestStorage?: AsyncLocalStorage<RequestContext> }
const storage = (globalStore.__xmartmenuRequestStorage ??= new AsyncLocalStorage<RequestContext>())

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn)
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore()
}

// Read by the Supabase clients (src/lib/supabase/server.ts) without importing
// this Node-only module there — that file is also bundled for the Edge
// middleware. Every database call made inside a request then carries
// x-request-id / x-actor-id, which the audit trigger records.
;(globalThis as { __xmartmenuRequestContext?: () => RequestContext | undefined }).__xmartmenuRequestContext = getRequestContext

/** Records who is acting (and for which restaurant) on the current request. */
export function setRequestContext(patch: Partial<Omit<RequestContext, 'requestId'>>): void {
  const context = storage.getStore()
  if (context) Object.assign(context, patch)
  try {
    if (patch.tenantId) Sentry.setTag('tenant_id', patch.tenantId)
    if (patch.role) Sentry.setTag('role', patch.role)
    if (patch.actorId) Sentry.setUser({ id: patch.actorId })
  } catch {
    // Sentry not initialised (no DSN): nothing to tag.
  }
}
