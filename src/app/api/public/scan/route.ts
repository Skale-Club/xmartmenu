import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { adminMenusOwned, AdminMenuError } from '@/lib/data/admin-menus'
import { recordOwnedPublicScan } from '@/lib/data/public-scans-runtime'
import { readNativeAnalyticsBody } from '@/lib/data/public-analytics'

export const runtime = 'nodejs'

/**
 * POST /api/public/scan
 * Body: { tenant_id: string }
 *
 * Anonymous endpoint that records a QR scan. Lives outside the ISR-cached
 * tenant page so each visit is recorded (round-2 P0-08 fix). Fire-and-forget
 * from the client — failures are intentionally swallowed and the page
 * continues to load.
 *
 * scan_events has an anon-insert RLS policy so the service client is used
 * here only to bypass any future tightening; the route does not trust any
 * other body field.
 */
export async function POST(request: Request) {
  try {
    const rl = await rateLimit('public-scan', getClientIp(request), 30, '1 m')
    if (!rl.ok) return NextResponse.json({ ok: false }, { status: 429 })

    const owned = adminMenusOwned()
    const { tenant_id } = (owned
      ? JSON.parse(await readNativeAnalyticsBody(request))
      : await request.json()) as { tenant_id?: string }
    if (!tenant_id || typeof tenant_id !== 'string') {
      return NextResponse.json({ ok: false }, { status: 400 })
    }
    if (owned) return NextResponse.json(await recordOwnedPublicScan(tenant_id))
    const service = await createServiceClient()
    // Confirm the tenant is real before inserting — drops random UUID spam.
    const { data: tenant } = await service
      .from('tenants')
      .select('id')
      .eq('id', tenant_id)
      .eq('is_active', true)
      .single()
    if (!tenant) {
      return NextResponse.json({ ok: false }, { status: 404 })
    }
    await service.from('scan_events').insert({ tenant_id })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof AdminMenuError) return NextResponse.json({ ok: false }, { status: error.status })
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
