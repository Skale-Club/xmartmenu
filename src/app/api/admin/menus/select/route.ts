import { createClient } from '@/lib/supabase/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
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
