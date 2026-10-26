/**
 * POST { slug } | { all: true } — drop the cached public menu
 * (src/lib/menu/public-menu-cache.ts) from outside the app: seed and
 * onboarding scripts, SQL applied by hand, the e2e fixtures.
 *
 * Guarded by a shared secret in the `x-revalidate-secret` header
 * (MENU_REVALIDATE_SECRET). With the variable unset the route does not
 * exist (404), so nothing is exposed by default. Like the other
 * /api/internal routes it bypasses the session middleware.
 */
import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { revalidateAllPublicMenus, revalidatePublicMenu } from '@/lib/menu/public-menu-cache'
import { withApi } from '@/lib/observability/with-api'

function secretMatches(given: string | null, expected: string): boolean {
  if (!given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function handlePOST(request: Request) {
  const expected = process.env.MENU_REVALIDATE_SECRET
  if (!expected) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!secretMatches(request.headers.get('x-revalidate-secret'), expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null) as { slug?: unknown; all?: unknown } | null
  if (body?.all === true) {
    revalidateAllPublicMenus()
    return NextResponse.json({ ok: true, all: true })
  }
  const slug = typeof body?.slug === 'string' ? body.slug.trim() : ''
  if (!slug) return NextResponse.json({ error: 'slug or all required' }, { status: 400 })
  revalidatePublicMenu(slug)
  return NextResponse.json({ ok: true, slug })
}

export const POST = withApi('POST /api/internal/revalidate-menu', handlePOST)
