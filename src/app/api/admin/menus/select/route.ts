import { createClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { NextResponse } from 'next/server'
import { withApi } from '@/lib/observability/with-api'
import { adminMenusOwned } from '@/lib/data/admin-menus'
import { ownedAuthSelected, UUID } from '@/lib/auth/owned-principal'
import { getIdentityServices } from '@/lib/auth/identity-services'

async function handlePOST(request: Request) {
  if (ownedAuthSelected()) {
    const effective = await getEffectiveTenant()
    if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { config, pool } = getIdentityServices()
    if (request.headers.get('origin') !== config.origin || request.headers.get('sec-fetch-site') === 'cross-site') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const body = await request.json().catch(() => null)
    if (typeof body?.menu_id !== 'string' || !UUID.test(body.menu_id)) return NextResponse.json({ error: 'Invalid menu_id' }, { status: 400 })
    const { rows } = await pool.query<{ id: string }>('SELECT id FROM public.menus WHERE id=$1 AND tenant_id=$2', [body.menu_id, effective.tenantId])
    if (rows.length !== 1) return NextResponse.json({ error: 'Menu not found' }, { status: 404 })
    const response = NextResponse.json({ ok: true, menu_id: rows[0].id })
    response.cookies.set('selected_menu_id', rows[0].id, { path: '/', maxAge: 60*60*24*365, sameSite: 'lax', httpOnly: true, secure: new URL(config.origin).protocol === 'https:' })
    return response
  }
  if (adminMenusOwned()) return (await import('@/lib/admin/owned-menu-http')).ownedMenuHttp(request, 'select')
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { menu_id } = await request.json()
  if (!menu_id) return NextResponse.json({ error: 'menu_id is required' }, { status: 400 })

  const supabase = await createClient()
  const { data: menu } = await supabase
    .from('menus')
    .select('id, tenant_id')
    .eq('id', menu_id)
    .single()

  if (!menu || menu.tenant_id !== effective.tenantId) {
    return NextResponse.json({ error: 'Menu not found' }, { status: 404 })
  }

  const res = NextResponse.json({ ok: true, menu_id: menu.id })
  res.cookies.set('selected_menu_id', menu.id, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  })

  return res
}

export const POST = withApi('POST /api/admin/menus/select', handlePOST)
