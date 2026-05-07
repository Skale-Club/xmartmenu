import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'

// Internal endpoint called by GH Actions after image uploads complete.
// GH Actions cannot call revalidatePath() directly (Next.js-only API).
// Secret validation prevents unauthorized cache invalidation.
// Per RESEARCH.md Pattern 8 — Pitfall 8 mitigation.
export const runtime = 'nodejs'

export async function POST(request: Request) {
  const body = await request.json() as {
    secret?: string
    tenantSlug?: string
    menuSlug?: string
  }

  const { secret, tenantSlug, menuSlug } = body

  if (!secret || secret !== process.env.VERCEL_REVALIDATE_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!tenantSlug) {
    return NextResponse.json({ error: 'tenantSlug is required' }, { status: 400 })
  }

  revalidatePath(`/${tenantSlug}`)
  if (menuSlug) {
    revalidatePath(`/${tenantSlug}/${menuSlug}`)
  }

  return NextResponse.json({ revalidated: true, tenantSlug })
}
