import { NextResponse } from 'next/server'
import { getRequestContext } from '../observability/context'
import { AdminMenuError } from '../data/admin-menus'
import type { AdminChatContext } from '../data/admin-chat'
import type { UserRole } from '@/types/database'
import { ownedAuthSelected } from '../auth/owned-principal'
import { getOwnedPrincipal } from '../auth/owned-principal-runtime'
import { createClient } from '../supabase/server'

/** getEffectiveTenant has just verified the actor and set this request context. */
export async function adminChatContext(effective: { tenantId: string; role: UserRole }): Promise<AdminChatContext> {
  let actorId: string | undefined
  if (ownedAuthSelected()) {
    const principal = await getOwnedPrincipal()
    if (!principal || principal.mustChangePassword || principal.role !== effective.role || (principal.role !== 'superadmin' && principal.tenantId !== effective.tenantId)) throw new AdminMenuError(401, 'Unauthorized')
    actorId = principal.userId
  } else {
    actorId = getRequestContext()?.actorId
    // SSR is outside withApi's request context; retain explicit legacy Auth
    // only while the server has selected that authority.
    if (!actorId) { const auth = await createClient(); actorId = (await auth.auth.getUser()).data.user?.id }
  }
  if (!actorId) throw new AdminMenuError(401, 'Unauthorized')
  return { tenantId: effective.tenantId, role: effective.role, actorId }
}
export function adminChatError(error: unknown) {
  return NextResponse.json({ error: error instanceof AdminMenuError ? error.message : 'Chat service is unavailable' }, { status: error instanceof AdminMenuError ? error.status : error instanceof SyntaxError ? 400 : 503 })
}
