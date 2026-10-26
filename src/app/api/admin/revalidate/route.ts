/**
 * POST — drop the cached public menu of the signed-in restaurant
 * (src/lib/menu/public-menu-cache.ts). Called by admin screens that write
 * straight to Supabase from the browser; the API routes revalidate on their
 * own. Any member of the restaurant may call it: it only refreshes data.
 */
import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { revalidatePublicMenu } from '@/lib/menu/public-menu-cache'
import { withApi } from '@/lib/observability/with-api'

async function handlePOST() {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  revalidatePublicMenu(effective.slug)
  return NextResponse.json({ ok: true })
}

export const POST = withApi('POST /api/admin/revalidate', handlePOST)
