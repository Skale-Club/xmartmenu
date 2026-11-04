import { NextResponse } from 'next/server'
import { getEffectiveTenant } from '@/lib/get-effective-tenant'
import { AdminMenuError } from '@/lib/data/admin-menus'
import { ownedCatalogEnabled, type IngredientMutation } from '@/lib/data/admin-ingredients'
import { listOwnedIngredients, mutateOwnedIngredient } from '@/lib/data/admin-ingredients-runtime'

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })

export async function ownedIngredientHttp(request: Request, kind: 'list' | 'create' | 'patch' | 'delete' | 'reorder', id?: string) {
  if (!ownedCatalogEnabled()) return json({ error: 'Not found' }, 404)
  try {
    const effective = await getEffectiveTenant()
    if (!effective) return json({ error: 'Unauthorized' }, 401)
    const context = { tenantId: effective.tenantId, role: effective.role }
    if (kind === 'list') return json(await listOwnedIngredients(context))
    if (effective.role === 'store-staff') return json({ error: 'Forbidden' }, 403)
    const target = new URL(request.url)
    const sameOrigin = `${target.protocol}//${request.headers.get('host') ?? target.host}`
    if (request.headers.get('origin') !== sameOrigin) return json({ error: 'Origin mismatch' }, 403)
    const mutation: IngredientMutation = kind === 'delete' ? { kind, id: id ?? '' }
      : kind === 'patch' ? { kind, id: id ?? '', body: await request.json() }
        : { kind, body: await request.json() }
    return json(await mutateOwnedIngredient(context, mutation), kind === 'create' ? 201 : 200)
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: 'Invalid ingredient' }, 400)
    if (error instanceof AdminMenuError && error.status < 500) return json({ error: error.message }, error.status)
    return json({ error: 'Ingredient service is unavailable' }, 503)
  }
}
