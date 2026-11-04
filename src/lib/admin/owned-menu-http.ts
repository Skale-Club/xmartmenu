import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { AdminMenuError } from '@/lib/data/admin-menus'
import { findOwnedAdminMenu, listOwnedAdminMenus, mutateOwnedAdminMenu } from '@/lib/data/admin-menus-runtime'

/** Invoked only by the explicit owned branch; no Supabase data fallback. */
export async function ownedMenuHttp(request: Request | null, kind: 'list' | 'create' | 'patch' | 'delete' | 'select', id?: string) {
  const effective = await getEffectiveTenant()
  if (!effective) return NextResponse.json({ error: kind === 'patch' || kind === 'delete' ? 'Not found' : 'Unauthorized' }, { status: kind === 'patch' || kind === 'delete' ? 404 : 401 })
  const context = { tenantId: effective.tenantId, role: effective.role }
  try {
    if (kind === 'list') return NextResponse.json(await listOwnedAdminMenus(context))
    if (kind === 'select') {
      const body = await request!.json()
      if (!body.menu_id) return NextResponse.json({ error: 'menu_id is required' }, { status: 400 })
      const menu = typeof body.menu_id === 'string' ? await findOwnedAdminMenu(context, body.menu_id) : null
      if (!menu) return NextResponse.json({ error: 'Menu not found' }, { status: 404 })
      const response = NextResponse.json({ ok: true, menu_id: menu.id })
      response.cookies.set('selected_menu_id', menu.id, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax', httpOnly: true, secure: process.env.NODE_ENV === 'production' })
      return response
    }
    // Preserve permission/ownership ordering, including no body read for staff.
    if (kind === 'create' && effective.role === 'store-staff') throw new AdminMenuError(403, 'Forbidden')
    if ((kind === 'patch' || kind === 'delete') && effective.role === 'store-staff') {
      const menu = await findOwnedAdminMenu(context, id ?? '')
      throw new AdminMenuError(menu ? 403 : 404, menu ? 'Forbidden' : 'Not found')
    }
    const mutation = kind === 'create' ? { kind, body: await request!.json() } as const
      : kind === 'patch' ? { kind, id: id ?? '', body: await request!.json() } as const
        : { kind: 'delete', id: id ?? '' } as const
    const result = await mutateOwnedAdminMenu(context, mutation)
    return NextResponse.json(result, { status: kind === 'create' ? 201 : 200 })
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Invalid menu' }, { status: 400 })
    if (error instanceof AdminMenuError) return NextResponse.json({ error: error.message }, { status: error.status })
    return NextResponse.json({ error: 'Menu service is unavailable' }, { status: 503 })
  }
}
