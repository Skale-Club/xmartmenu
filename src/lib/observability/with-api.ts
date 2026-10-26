/**
 * Wraps an API route handler with the request's observability:
 *
 *   export const POST = withApi('POST /api/orders', async (request) => { … })
 *
 * - opens the request context (request id from the middleware, route, method);
 * - logs one `http.request` line per call with status and duration;
 * - on an unexpected throw: logs it, reports it to Sentry tagged with the
 *   request id, and answers 500 with that id so a user report leads straight
 *   to the logs ("request_id" in the body, `x-request-id` header).
 */
import * as Sentry from '@sentry/nextjs'
import { NextResponse } from 'next/server'
import { getRequestContext, runWithRequestContext } from './context'
import { log } from './log'
import { REQUEST_ID_HEADER, resolveRequestId } from './request-id'
import { applyMenuCacheAction, menuCacheActionFor } from '@/lib/menu/menu-cache-hooks'

// Next passes `{ params }` as the second argument for dynamic routes; some
// handlers take a NextRequest, so the request type is generic too.
type Handler<R extends Request, C> = (request: R, context: C) => Promise<Response> | Response

export function withApi<R extends Request = Request, C = unknown>(route: string, handler: Handler<R, C>): (request: R, context: C) => Promise<Response> {
  return async (request, context) => {
    const requestId = resolveRequestId(request.headers)
    const startedAt = performance.now()
    return runWithRequestContext({ requestId, route, method: request.method }, async () => {
      let response: Response
      try {
        response = await handler(request, context)
      } catch (error) {
        log.error('http.unhandled_error', { err: error })
        Sentry.withScope(scope => {
          scope.setTag('request_id', requestId)
          scope.setTag('route', route)
          Sentry.captureException(error)
        })
        response = NextResponse.json({ error: 'Internal server error', request_id: requestId }, { status: 500 })
      }
      const status = response.status
      const fields = { method: request.method, status, duration_ms: Math.round(performance.now() - startedAt) }
      if (status >= 500) log.error('http.request', fields)
      else if (status >= 400) log.warn('http.request', fields)
      else log.info('http.request', fields)
      // A successful write through an admin, superadmin, billing or webhook
      // route makes the cached public menu stale (menu-cache-hooks.ts).
      if (status < 300) {
        await applyMenuCacheAction(menuCacheActionFor(request.method, new URL(request.url).pathname), getRequestContext()?.tenantSlug)
      }
      try {
        response.headers.set(REQUEST_ID_HEADER, requestId)
      } catch {
        // Immutable headers (e.g. a proxied Response): the middleware already set it.
      }
      return response
    })
  }
}
