import { GoogleAuth } from 'google-auth-library'
import { Pool } from 'pg'
import { createIdentityHttp } from './identity-http'
import { IdentityStore } from './identity-store'
import { createGoogleAccountStatusReader } from './provider-account-status'
import { verifyGoogleIdentity } from './google-identity'
import { identityLegacyProofConfig, identityRuntimeConfig } from './identity-runtime-config'
import { createLegacyOwnerReader } from './legacy-account-proof'
import { verifyPublicProject } from './public-project-proof'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

let handler: ReturnType<typeof createIdentityHttp> | undefined
function runtime() {
  if (handler) return handler
  const config = identityRuntimeConfig()
  const pool = new Pool({ connectionString: config.connectionString, ssl: config.ssl,
    max: 2, connectionTimeoutMillis: 5_000, statement_timeout: 5_000, idleTimeoutMillis: 30_000 })
  // Errors on idle clients must not crash the shared process or expose a URL.
  pool.on('error', () => {})
  const google = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/identitytoolkit'] })
  const status = createGoogleAccountStatusReader(async () => {
    const token = await google.getAccessToken()
    if (!token) throw new Error('Provider credentials unavailable')
    return token
  })
  handler = createIdentityHttp({
    enabled: () => process.env.GOOGLE_AUTH_ENABLED === 'true', origin: config.origin, config: config.web,
    verifyConfig: () => verifyPublicProject({ ...config.web, projectNumber: config.projectNumber, origin: config.origin }),
    allowRequest: async request => (await rateLimit('identity-pilot', getClientIp(request), 30, '15 m')).ok,
    verify: token => verifyGoogleIdentity(token, config.web.projectId, { recent: true }),
    legacyOwner: async (token, signal) => {
      try {
        // Independent online proof by immutable UID; never an email/JWKS fallback.
        return await createLegacyOwnerReader(identityLegacyProofConfig())(token, signal)
      } catch { return null }
    },
    store: new IdentityStore(pool, status),
  })
  return handler
}

export async function identityRoute(request: Request, operation: string): Promise<Response> {
  if (process.env.GOOGLE_AUTH_ENABLED !== 'true') return Response.json({ message: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  try { return await runtime()(request, operation) }
  catch { return Response.json({ message: 'Identity verification is temporarily unavailable.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }) }
}
