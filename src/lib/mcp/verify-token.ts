import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import { createServiceClient } from '@/lib/supabase/server'
import { normalizeRole, parseSuperadminEmails } from '@/lib/auth/role-utils'
import { captureSecurityEvent } from '@/lib/observability'

/**
 * MCP bearer-token gate (`withMcpAuth` verifyToken).
 *
 * The token is an OAuth 2.1 access token issued by Supabase Auth (the platform's
 * authorization server). We validate it by resolving the Supabase user, then
 * authorize ONLY platform superadmins — matching the same rule as the web app
 * (`profiles.role === 'superadmin'` or an email in `SUPERADMIN_EMAILS`).
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

  let isSuperadmin = normalizeRole(profile?.role) === 'superadmin'
  if (!isSuperadmin) {
    const email = user.email?.toLowerCase() ?? ''
    isSuperadmin = email.length > 0 && parseSuperadminEmails().includes(email)
  }

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
