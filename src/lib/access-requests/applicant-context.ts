import { createHash } from 'node:crypto'
import { ownedSessionToken } from '@/lib/auth/owned-principal'
import { getOwnedPrincipal } from '@/lib/auth/owned-principal-runtime'
import { getIdentityServices } from '@/lib/auth/identity-services'
import { NativeOnboardingDenied } from '@/lib/auth/native-onboarding'

/**
 * The signed-in business account behind this browser session, shared by the
 * onboarding route and the access-request API. Refuses cross-origin, preview and
 * demo requests and any request without the current browser session.
 */
export async function ownedApplicantContext(request: Request) {
  if (process.env.OWNED_ONBOARDING_ENABLED !== 'true') throw new Error('Onboarding unavailable')
  const origin = new URL(getIdentityServices().config.origin)
  if (request.headers.get('host')?.toLowerCase() !== origin.host.toLowerCase()
    || request.headers.get('sec-fetch-site') === 'cross-site'
    || (request.method !== 'GET' && request.method !== 'HEAD' && request.headers.get('origin') !== origin.origin)
    || /(?:^|;)\s*(?:preview_tenant_id|xm_demo)=/.test(request.headers.get('cookie') ?? '')) throw new NativeOnboardingDenied('Origin or mode denied')
  const principal = await getOwnedPrincipal()
  if (!principal) throw new NativeOnboardingDenied('Authentication required')
  const token = ownedSessionToken(request.headers.get('cookie'), origin.protocol === 'https:')
  if (!token) throw new NativeOnboardingDenied('Current browser session required')
  const session = await getIdentityServices().store.session(token)
  if (!session || session.userId !== principal.userId) throw new NativeOnboardingDenied('Current browser session required')
  return { ...principal, sessionHash: createHash('sha256').update(token).digest('hex') }
}
