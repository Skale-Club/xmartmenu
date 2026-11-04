import { createHash } from 'node:crypto'
import { assertProviderAccountActive, type ProviderIdentity } from './provider-account-status'
import type { CustomerAccountStatus } from './google-customer-account'
import { OPAQUE_SESSION, type IdentityQuery, type OwnedPrincipal } from './owned-principal'

export type OwnedCustomer = OwnedPrincipal & { phoneE164: string | null }
export async function readOwnedCustomer(principal: OwnedPrincipal | null, token: string | null, query: IdentityQuery,
  metadata: (identity: ProviderIdentity) => Promise<CustomerAccountStatus>): Promise<OwnedCustomer | null> {
  if (!principal || principal.mustChangePassword || !token || !OPAQUE_SESSION.test(token)) return null
  const { rows } = await query<{ user_id: string; authenticated_at: Date; project_id: string; subject: string; provider: string }>(
    `SELECT s.user_id,s.authenticated_at,s.project_id,s.subject,b.provider FROM public.app_sessions s
     JOIN public.app_accounts a ON a.id=s.user_id JOIN public.app_identity_bindings b ON b.project_id=s.project_id AND b.subject=s.subject AND b.user_id=s.user_id
     WHERE s.token_hash=$1 AND s.user_id=$2 AND s.expires_at>now() AND a.disabled_at IS NULL
       AND s.session_version=a.session_version AND b.disabled_at IS NULL`,[createHash('sha256').update(token).digest('hex'),principal.userId])
  const session = rows[0]
  if (rows.length !== 1 || session.user_id !== principal.userId || session.authenticated_at.getTime() !== principal.authenticatedAt.getTime()) return null
  // Google-only bindings retain their UUID access, without a phone assertion.
  if (session.provider !== 'phone') return { ...principal,phoneE164: null }
  const current = await metadata({ projectId: session.project_id,subject: session.subject })
  assertProviderAccountActive(current,Math.floor(session.authenticated_at.getTime()/1000))
  return { ...principal,phoneE164: current.phoneE164 }
}
