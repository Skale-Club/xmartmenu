import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { cache } from 'react'

// Audit attribution (see src/lib/observability/context.ts and the
// audit_row_change() trigger): inside a request, every PostgREST call carries
// the request id and, for service-role calls, who is acting.
type RequestContextGetter = () => { requestId?: string; actorId?: string } | undefined

const auditedFetch: typeof fetch = (input, init) => {
  const context = (globalThis as { __xmartmenuRequestContext?: RequestContextGetter }).__xmartmenuRequestContext?.()
  if (!context?.requestId && !context?.actorId) return fetch(input, init)
  const headers = new Headers(init?.headers)
  if (context.requestId) headers.set('x-request-id', context.requestId)
  if (context.actorId) headers.set('x-actor-id', context.actorId)
  return fetch(input, { ...init, headers })
}

const createClientUncached = async () => {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: auditedFetch },
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}

// Per-request cache prevents multiple clients in the same request.
export const createClient = cache(createClientUncached)

// Service client uses the service key directly without cookie dependencies.
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false }, global: { fetch: auditedFetch } }
  )
}
