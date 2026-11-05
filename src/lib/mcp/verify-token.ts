import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { createServiceClient } from '@/lib/supabase/server'
import { normalizeRole } from '@/lib/auth/role-utils'
import { captureSecurityEvent } from '@/lib/observability'
import { nativeMcpSelected } from './oauth-model'
import { nativeMcpBearer } from './runtime'
import { currentMcpIdentity } from './data/authority'
import { markInvalidMcpOrigin } from './request-state'

/**
 * MCP bearer-token gate (`withMcpAuth` verifyToken).
 *
 * The token is an OAuth 2.1 access token issued by Supabase Auth (the platform's
 * authorization server). We validate it by resolving the Supabase user, then
 * authorize ONLY platform superadmins — matching the same rule as the web app
 * (`profiles.role === 'superadmin'`). Email does not grant privileges.
 *
 * Returning `undefined` makes `withMcpAuth` respond 401 (no/invalid token) or,
 * effectively, deny access for a non-superadmin. This is the single real
 * authorization boundary for the whole MCP surface — every tool trusts it.
 */
export async function verifyMcpToken(
  _req: Request,
  bearerToken?: string,
): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined
  if (nativeMcpSelected()) {
    try {
      if(_req.headers.get('authorization')?.match(/^Bearer (xm_mcp_at_[A-Za-z0-9_-]{43})$/i)?.[1]!==bearerToken) return undefined
      const actor=await nativeMcpBearer(bearerToken),identity=currentMcpIdentity(actor.oauth)
      const origin=_req.headers.get('origin')
      if(origin && origin!==new URL(identity.resource).origin && !identity.clientOrigins.includes(origin)) { markInvalidMcpOrigin(_req); return undefined }
      return { token:bearerToken,clientId:identity.clientId,scopes:identity.scopes,expiresAt:identity.expiresAt,
        extra:{ userId:identity.userId,nativeMcpActor:actor } }
    } catch { return undefined }
  }

  const service = createServiceClient()

  // Validates the JWT against Supabase Auth and returns the user, or errors.
  const {
    data: { user },
    error,
  } = await service.auth.getUser(bearerToken)
  if (error || !user) return undefined

  const { data: profile } = await service
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const isSuperadmin = normalizeRole(profile?.role) === 'superadmin'

  if (!isSuperadmin) {
    captureSecurityEvent('MCP access denied: non-superadmin token', {
      kind: 'mcp',
      userId: user.id,
      email: user.email,
    })
    return undefined
  }

  return {
    token: bearerToken,
    clientId: user.id,
    scopes: ['mcp:admin'],
    extra: { userId: user.id, email: user.email ?? null },
  }
}
