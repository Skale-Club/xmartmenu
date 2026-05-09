import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from './lib/supabase/middleware'

// Slugs that must never resolve to a tenant menu page.
// Named App Router routes (auth/, api/, dashboard/) self-resolve via file system
// and never reach [slug] | only add slugs here that have NO named file.
const BLOCKED_TENANT_SLUGS = new Set([
  'pricing', 'features', 'about', 'faq', 'blog', 'help', 'support',
  'pt', 'en', 'legal', 'privacy', 'terms', 'contact', 'careers',
])

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const firstSegment = pathname.split('/')[1]

  if (firstSegment && BLOCKED_TENANT_SLUGS.has(firstSegment)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return await updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
