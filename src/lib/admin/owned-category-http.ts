import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { AdminMenuError, adminMenusOwned } from '@/lib/data/admin-menus'
import { mutateOwnedCategory } from '@/lib/data/admin-categories-runtime'

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })

function exactOrigin(request: Request) {
  const origin = request.headers.get('origin')
  const host = request.headers.get('host')
  if (!origin || !host) return false
  try {
    const parsed = new URL(origin)
    const target = new URL(request.url)
    return parsed.origin === `${target.protocol}//${host}`
  } catch { return false }
}

export async function ownedCategoryHttp(request: Request, kind: 'create' | 'patch' | 'delete', id?: string) {
  if (!adminMenusOwned()) return json({ error: 'Not found' }, 404)
  try {
    const effective = await getEffectiveTenant()
    if (!effective) return json({ error: 'Unauthorized' }, 401)
    if (effective.role === 'store-staff') return json({ error: 'Forbidden' }, 403)
    if (!exactOrigin(request)) return json({ error: 'Origin mismatch' }, 403)
    const context = { tenantId: effective.tenantId, role: effective.role }
    let body: unknown
    if (kind !== 'delete') {
      try { body = await request.json() } catch { return json({ error: 'Invalid category' }, 400) }
    }
    const selectedMenuId = (await cookies()).get('selected_menu_id')?.value
    const mutation = kind === 'delete' ? { kind, id: id ?? '' } as const
      : kind === 'patch' ? { kind, id: id ?? '', body } as const
        : { kind, body, selectedMenuId } as const
    const result = await mutateOwnedCategory(context, mutation)
    return json(kind === 'delete' ? { success: true } : result, kind === 'create' ? 201 : 200)
  } catch (error) {
    if (error instanceof AdminMenuError && error.status < 500) return json({ error: error.message }, error.status)
    return json({ error: 'Category service is unavailable' }, 503)
  }
}
