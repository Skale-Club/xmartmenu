import { createIdentityHttp } from './identity-http'
import { verifyGoogleIdentity } from './google-identity'
import { identityLegacyProofConfig } from './identity-runtime-config'
import { createLegacyOwnerReader } from './legacy-account-proof'
import { verifyPublicProject } from './public-project-proof'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { getIdentityServices } from './identity-services'
import { readLegacyPasswordOwner } from './legacy-password-proof'
import { OwnedPrincipalRepository } from './owned-principal'
import { ownedAuthSelected } from './owned-principal'
import { NativeRegistration } from './native-registration'
import { completeOwnedStaffAccess } from '../data/account-administration-runtime'

let handler: ReturnType<typeof createIdentityHttp> | undefined
function runtime() {
  if (handler) return handler
  const { config, store, pool, customerAccount } = getIdentityServices()
  const registration = new NativeRegistration(pool,config.web.projectId,customerAccount)
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
    legacyPasswordOwner: (email,password,signal) => readLegacyPasswordOwner(email,password,{ signal }),
    eligibleOwner: async userId => {
      const principal = await new OwnedPrincipalRepository((text,values) => pool.query(text,values)).profile(userId,new Date())
      return !!principal && !principal.mustChangePassword
    },
    store,
    completeStaffAccess: completeOwnedStaffAccess,
    register: async (identity,name,kind) => {
      if (!ownedAuthSelected() || process.env.OWNED_REGISTRATION_ENABLED !== 'true') throw new Error('Native registration unavailable')
      return registration.create(identity,name,kind)
    },
  })
  return handler
}

export async function identityRoute(request: Request, operation: string): Promise<Response> {
  if (process.env.GOOGLE_AUTH_ENABLED !== 'true') return Response.json({ message: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  try { return await runtime()(request, operation) }
  catch { return Response.json({ message: 'Identity verification is temporarily unavailable.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }) }
}
