import { createClient } from '@/lib/supabase/server'
import { setRequestContext } from '@/lib/observability/context'
import { normalizeRole } from '@/lib/auth/role-utils'
import { ownedAuthSelected, type OwnedPrincipal } from '@/lib/auth/owned-principal'
import { getOwnedPrincipal } from '@/lib/auth/owned-principal-runtime'

export async function isSuperadminRequest() {
  return (await assertSuperadmin()) !== null
}

/**
 * SEC-03: Canonical superadmin auth guard for API routes.
 * Returns an explicit authorization context; data adapters are separate.
 *
 * Usage:
 *   const authorization = await assertSuperadmin()
 *   if (!authorization) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
 */
export type SuperadminAuthorization =
  | { mode: 'owned'; principal: OwnedPrincipal }
  | { mode: 'legacy'; principal: { userId: string; role: 'superadmin' }; legacyClient: Awaited<ReturnType<typeof createClient>> }

export async function assertSuperadmin(): Promise<SuperadminAuthorization | null> {
  if (ownedAuthSelected()) {
    const principal = await getOwnedPrincipal()
    if (!principal || principal.role !== 'superadmin' || principal.mustChangePassword) return null
    setRequestContext({ actorId: principal.userId, role: 'superadmin' })
    return { mode: 'owned', principal }
  }
  const legacyClient = await createClient()
  const { data: { user } } = await legacyClient.auth.getUser()
  if (!user) return null
  const { data: profile } = await legacyClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  const isSuperadmin = normalizeRole(profile?.role) === 'superadmin'
  if (isSuperadmin) setRequestContext({ actorId: user.id, role: 'superadmin' })
  return isSuperadmin ? { mode: 'legacy', principal: { userId: user.id, role: 'superadmin' }, legacyClient } : null
}
