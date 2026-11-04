import { normalizeRole } from './role-utils'
import type { UserRole } from '@/types/database'

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export const OPAQUE_SESSION = /^[A-Za-z0-9_-]{43}$/
export interface PrincipalTenant { id: string; name: string; slug: string; is_active: boolean; plan: string }
export interface OwnedPrincipal {
  userId: string
  authenticatedAt: Date
  role: UserRole
  tenantId: string | null
  fullName: string | null
  mustChangePassword: boolean
  tenant: PrincipalTenant | null
}
export type IdentityQuery = <R extends object = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<{ rows: R[] }>

export class OwnedAuthenticationUnavailable extends Error {
  constructor() { super('Authentication is temporarily unavailable'); this.name = 'OwnedAuthenticationUnavailable' }
}
export class LegacyIdentityBoundaryUnavailable extends Error {
  constructor() { super('This operation is temporarily unavailable'); this.name = 'LegacyIdentityBoundaryUnavailable' }
}

export function ownedAuthSelected(env: Record<string, string | undefined> = process.env): boolean {
  const selected = env.OWNED_AUTH_ENABLED
  if (selected !== undefined && selected !== 'true' && selected !== 'false') throw new Error('Invalid authentication mode')
  return selected === 'true'
}

/** No URI decoding, duplicate-cookie preference or legacy-cookie fallback. */
export function ownedSessionToken(cookie: string | null, secure: boolean): string | null {
  const name = secure ? '__Host-xm_identity' : 'xm_identity'
  const values = (cookie ?? '').split(';').map(row => row.trim()).filter(row => row.startsWith(`${name}=`))
  if (values.length !== 1) return null
  const token = values[0].slice(name.length+1)
  return OPAQUE_SESSION.test(token) ? token : null
}

interface ProfileRow {
  id: string; role: unknown; tenant_id: string | null; full_name: string | null
  must_change_password: boolean | null; account_disabled_at: Date | null; tenant: PrincipalTenant | null
}

export class OwnedPrincipalRepository {
  constructor(readonly query: IdentityQuery) {}

  async profile(userId: string, authenticatedAt: Date): Promise<OwnedPrincipal | null> {
    if (!UUID.test(userId) || !Number.isFinite(authenticatedAt.getTime()) || authenticatedAt.getTime() > Date.now()+5_000) return null
    const { rows } = await this.query<ProfileRow>(`SELECT p.id,p.role,p.tenant_id,p.full_name,p.must_change_password,
      a.disabled_at AS account_disabled_at,
      CASE WHEN t.id IS NULL THEN NULL ELSE jsonb_build_object('id',t.id,'name',t.name,'slug',t.slug,'is_active',t.is_active,'plan',t.plan) END AS tenant
      FROM public.profiles p JOIN public.app_accounts a ON a.id=p.id
      LEFT JOIN public.tenants t ON t.id=p.tenant_id
      WHERE p.id=$1 AND a.disabled_at IS NULL`, [userId])
    const profile = rows[0], role = normalizeRole(profile?.role)
    if (rows.length !== 1 || !profile || profile.id !== userId || !role || profile.account_disabled_at
      || (profile.tenant_id && !UUID.test(profile.tenant_id))
      || (profile.tenant && profile.tenant.id !== profile.tenant_id)) return null
    return { userId, authenticatedAt, role, tenantId: profile.tenant_id, fullName: profile.full_name,
      mustChangePassword: profile.must_change_password === true, tenant: profile.tenant }
  }

  async previewTenant(principal: OwnedPrincipal, id: string): Promise<PrincipalTenant | null> {
    if (principal.role !== 'superadmin' || principal.mustChangePassword || !UUID.test(id)) return null
    const { rows } = await this.query<PrincipalTenant>(
      'SELECT id,name,slug,is_active,plan FROM public.tenants WHERE id=$1', [id])
    return rows.length === 1 && rows[0].id === id ? rows[0] : null
  }
}

/** SessionStore.session performs the existing online provider/revocation check. */
export async function readOwnedPrincipal(token: string | null,
  sessions: { session: (token: string) => Promise<{ userId: string; authenticatedAt: Date } | null> },
  repository: OwnedPrincipalRepository): Promise<OwnedPrincipal | null> {
  if (!token || !OPAQUE_SESSION.test(token)) return null
  const session = await sessions.session(token)
  if (!session) return null
  return repository.profile(session.userId, session.authenticatedAt)
}
