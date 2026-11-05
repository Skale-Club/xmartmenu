import type { VerifiedGoogleIdentity } from './google-identity'
import { RegistrationConflict, type RegistrationKind } from './native-registration'
import { AdminMenuError } from '../data/admin-menus'
import { resolveLogin, type AccountRef } from './identity-policy'

const OPAQUE = /^[A-Za-z0-9_-]{43}$/
const BODY_LIMIT = 20_000
type Principal = { userId: string; authenticatedAt: Date }
export interface IdentityHttpDependencies {
  enabled: () => boolean
  origin: string
  config: { apiKey: string; projectId: string; authDomain: string }
  verifyConfig: () => Promise<void>
  allowRequest: (request: Request) => Promise<boolean>
  verify: (token: string) => Promise<VerifiedGoogleIdentity>
  legacyOwner: (token: string, signal?: AbortSignal) => Promise<string | null>
  legacyPasswordOwner?: (email: unknown, password: unknown, signal?: AbortSignal) => Promise<string | null>
  eligibleOwner?: (userId: string) => Promise<boolean>
  register?: (identity: VerifiedGoogleIdentity, name: string, kind: RegistrationKind) => Promise<{ token: string; expiresAt: Date }>
  completeStaffAccess?: (identity: VerifiedGoogleIdentity, code: string, kind: 'invite'|'recovery') => Promise<{ token:string; expiresAt:Date }>
  store: {
    issueChallenge: () => Promise<string>
    consumeChallenge: (token: string) => Promise<boolean>
    owner: (identity: VerifiedGoogleIdentity) => Promise<string | null>
    bind: (identity: VerifiedGoogleIdentity, userId: string, proof: 'legacy-session' | 'owned-session' | 'google-subject' | 'phone-match') => Promise<void>
    // Xpot-style first sign-in. Absent = this deployment links only through the explicit routes.
    googleClaim?: (googleSub: string) => Promise<AccountRef | null>
    phoneOwners?: (phone: string) => Promise<AccountRef[]>
    issuePending?: (identity: VerifiedGoogleIdentity) => Promise<string>
    takePending?: (token: string) => Promise<{ projectId: string; subject: string; authenticatedAt: number } | null>
    bindPendingGoogle?: (pending: { projectId: string; subject: string; authenticatedAt: number }, userId: string) => Promise<boolean>
    createSession: (identity: VerifiedGoogleIdentity) => Promise<{ token: string; expiresAt: Date }>
    session: (token: string) => Promise<Principal | null>
    logout: (token: string) => Promise<void>
    revokeAll: (userId: string) => Promise<void>
  }
}

function cookie(request: Request, name: string): string | null {
  const values = (request.headers.get('cookie') ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${name}=`))
  return values.length === 1 ? values[0].slice(name.length + 1) : null
}

function cookiePresent(request: Request, name: string): boolean {
  return (request.headers.get('cookie') ?? '').split(';').some(part => part.trim().startsWith(`${name}=`))
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new Error('Invalid request')
  const declaredLength = Number(request.headers.get('content-length') ?? 0)
  if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > BODY_LIMIT) throw new Error('Invalid request')
  const reader = request.body?.getReader()
  if (!reader) throw new Error('Invalid request')
  const chunks: Uint8Array[] = []
  let size = 0
  let timeout: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => { reject(new Error('Invalid request')); void reader.cancel().catch(() => {}) }, 5_000)
  })
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), deadline])
      if (next.done) break
      size += next.value.byteLength
      if (size > BODY_LIMIT) { void reader.cancel().catch(() => {}); throw new Error('Invalid request') }
      chunks.push(next.value)
    }
  } finally { clearTimeout(timeout); reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  const body: unknown = JSON.parse(new TextDecoder().decode(bytes))
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid request')
  return body as Record<string, unknown>
}

/** Standalone pilot: this never grants roles or substitutes legacy route guards. */
export function createIdentityHttp(deps: IdentityHttpDependencies) {
  const origin = new URL(deps.origin)
  const secure = origin.protocol === 'https:'
  const sessionName = `${secure ? '__Host-' : ''}xm_identity`
  const challengeName = `${secure ? '__Host-' : ''}xm_identity_challenge`
  const pendingName = `${secure ? '__Host-' : ''}xm_identity_pending`
  const reply = (body: object, status = 200) => Response.json(body, { status, headers: {
    'Cache-Control': 'no-store', Pragma: 'no-cache', Vary: 'Cookie', 'Referrer-Policy': 'no-referrer',
  } })
  const setCookie = (response: Response, name: string, value: string, age: number) => {
    response.headers.append('Set-Cookie', `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`)
  }
  const readSession = (request: Request) => {
    const token = cookie(request, sessionName)
    return token && OPAQUE.test(token) ? deps.store.session(token) : Promise.resolve(null)
  }
  const claimBrowser = (request: Request, body: Record<string, unknown>) => {
    const challenge = cookie(request, challengeName)
    return challenge && OPAQUE.test(challenge) && body.challenge === challenge
      ? deps.store.consumeChallenge(challenge) : Promise.resolve(false)
  }
  const recent = (principal: Principal) => {
    const age = Date.now() - principal.authenticatedAt.getTime()
    return age >= -5_000 && age <= 300_000
  }

  return async (request: Request, operation: string): Promise<Response> => {
    if (!deps.enabled()) return reply({ message: 'Not found' }, 404)
    if (request.headers.get('host')?.toLowerCase() !== origin.host.toLowerCase()) return reply({ message: 'Not found' }, 404)
    const method = ['config', 'session'].includes(operation) ? 'GET' : 'POST'
    const registration = operation === 'register-customer' || operation === 'register-business'
    const staffAccess = operation === 'accept-staff-invite' || operation === 'recover-staff'
    if (!['config', 'session', 'challenge', 'login', 'link', 'existing-account-link', 'logout', 'revoke-all'].includes(operation) && !registration && !staffAccess) return reply({ message: 'Not found' }, 404)
    if (registration && !deps.register) return reply({ message: 'Registration is temporarily unavailable.' }, 503)
    if (staffAccess && !deps.completeStaffAccess) return reply({ message:'Staff access is unavailable.' },503)
    if (request.method !== method) return reply({ message: 'Method not allowed' }, 405)
    if (request.headers.get('sec-fetch-site') === 'cross-site'
      || (method === 'POST' && request.headers.get('origin') !== origin.origin)) return reply({ message: 'Origin mismatch' }, 403)
    try {
      if (!(await deps.allowRequest(request))) return reply({ message: 'Too many attempts. Try again later.' }, 429)
      if (operation === 'config') { await deps.verifyConfig(); return reply(deps.config) }
      if (operation === 'session') {
        const principal = await readSession(request)
        return principal ? reply({ authenticated: true }) : reply({ message: 'Authentication required' }, 401)
      }
      let body: Record<string, unknown>
      try { body = await readBody(request) }
      catch { return reply({ message: 'Invalid request' }, 400) }
      if (operation === 'challenge') {
        const challenge = await deps.store.issueChallenge()
        const response = reply({ challenge })
        setCookie(response, challengeName, challenge, 120)
        return response
      }
      if (operation === 'logout') {
        const token = cookie(request, sessionName)
        if (token && OPAQUE.test(token)) await deps.store.logout(token)
        const response = reply({ signedOut: true })
        setCookie(response, sessionName, '', 0); setCookie(response, challengeName, '', 0)
        return response
      }
      if (operation === 'revoke-all') {
        const principal = await readSession(request)
        if (!principal) return reply({ message: 'Authentication required' }, 401)
        await deps.store.revokeAll(principal.userId)
        const response = reply({ signedOut: true })
        setCookie(response, sessionName, '', 0); setCookie(response, challengeName, '', 0)
        return response
      }
      if (typeof body.idToken !== 'string' || !body.idToken || body.idToken.length > 16_384) return reply({ message: 'Verified sign-in required' }, 401)
      let identity: VerifiedGoogleIdentity
      try { identity = await deps.verify(body.idToken) }
      catch { return reply({ message: 'A recent verified phone or Google sign-in is required.' }, 401) }
      const age = Date.now() / 1000 - identity.authenticatedAt
      if (identity.projectId !== deps.config.projectId || !Number.isSafeInteger(identity.authenticatedAt)
        || age < -5 || age > 300) return reply({ message: 'A recent verified phone or Google sign-in is required.' }, 401)
      if (staffAccess) {
        if (request.headers.has('authorization') || cookiePresent(request,'preview_tenant_id') || cookiePresent(request,'xm_demo')
          || !OPAQUE.test(String(body.code)) || Object.keys(body).some(key => !['idToken','challenge','code'].includes(key))) return reply({ message:'Invalid staff access proof.' },403)
        const current = await readSession(request),owner = await deps.store.owner(identity)
        if (!owner || (current && current.userId !== owner)) return reply({ message:'Sign out and use the verified sign-in method already linked to the invited account.' },403)
        if (!(await claimBrowser(request,body))) return reply({ message:'Invalid or expired browser challenge.' },403)
        let next: { token:string;expiresAt:Date }
        try { next = await deps.completeStaffAccess!(identity,String(body.code),operation === 'accept-staff-invite' ? 'invite' : 'recovery') }
        catch (error) { if (error instanceof AdminMenuError && error.status < 500) return reply({ message:error.message },error.status); throw error }
        const response = reply({ authenticated:true })
        setCookie(response,sessionName,next.token,Math.max(0,Math.floor((next.expiresAt.getTime()-Date.now())/1000)))
        setCookie(response,challengeName,'',0);return response
      }
      if (registration) {
        if (request.headers.has('authorization') || cookiePresent(request, sessionName)
          || cookiePresent(request,'preview_tenant_id') || cookiePresent(request,'xm_demo')) return reply({ message: 'Sign out and leave preview or demo mode before creating an account.' },403)
        if (Object.keys(body).some(key => !['idToken','name','challenge'].includes(key))
          || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 120) return reply({ message: 'Enter your name. Extra account fields are not accepted.' },400)
        if (!(await claimBrowser(request,body))) return reply({ message: 'Invalid or expired browser challenge.' },403)
        let next: { token: string; expiresAt: Date }
        try { next = await deps.register!(identity,body.name,operation === 'register-business' ? 'business' : 'customer') }
        catch (error) {
          if (error instanceof RegistrationConflict) return reply({ code: 'ACCOUNT_LINK_REQUIRED',message: 'Use sign-in, independent account linking, or reviewed recovery.' },409)
          throw error
        }
        const response = reply({ authenticated: true },201)
        setCookie(response,sessionName,next.token,Math.max(0,Math.floor((next.expiresAt.getTime()-Date.now())/1000)))
        setCookie(response,challengeName,'',0)
        return response
      }
      if (operation === 'existing-account-link') {
        if (!deps.legacyPasswordOwner || !deps.eligibleOwner) return reply({ message: 'Not found' }, 404)
        if (cookiePresent(request,'preview_tenant_id') || cookiePresent(request,'xm_demo')) return reply({ message: 'Leave preview or demo mode before linking your account.' },403)
        if (request.headers.has('authorization') || Object.keys(body).some(key => !['email','password','idToken','challenge'].includes(key))) return reply({ message: 'Invalid account proof' },400)
        const principal = await readSession(request)
        if (cookiePresent(request,sessionName) && (!principal || !recent(principal))) return reply({ message: 'Sign in to your existing account again.' },401)
        if (!(await claimBrowser(request,body))) return reply({ message: 'Invalid or expired browser challenge.' },403)
        const userId = await deps.legacyPasswordOwner(body.email,body.password,request.signal)
        if (!userId || !await deps.eligibleOwner(userId)) return reply({ message: 'Existing account proof is unavailable. Use reviewed recovery if needed.' },403)
        if (principal && principal.userId !== userId) return reply({ message: 'Account ownership conflict.' },409)
        const bound = await deps.store.owner(identity)
        if (bound && bound !== userId) return reply({ message: 'Account ownership conflict.' },409)
        // Password grant produced a source Auth session, independently checked
        // online by getUser. Preserve the existing legacy-session proof category.
        await deps.store.bind(identity,userId,'legacy-session')
        const response = reply({ linked: true }); setCookie(response,challengeName,'',0)
        return response
      }
      if (operation === 'link') {
        if (cookiePresent(request, 'preview_tenant_id')) return reply({ message: 'Leave the company preview before linking your account.' }, 403)
        const existingToken = cookiePresent(request, sessionName)
        const principal = await readSession(request)
        if (existingToken && (!principal || !recent(principal))) return reply({ message: 'Sign in to your existing account again.' }, 401)
        const authorization = request.headers.get('authorization')
        const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null
        const legacy = bearer && bearer.length <= 16_384 ? await deps.legacyOwner(bearer, request.signal) : null
        if (bearer && !legacy) return reply({ message: 'Existing account proof is unavailable.' }, 401)
        if (principal && legacy && principal.userId !== legacy) return reply({ message: 'Account ownership conflict.' }, 409)
        const userId = principal?.userId ?? legacy
        if (!userId) return reply({ message: 'Sign in to your existing account first.' }, 401)
        const bound = await deps.store.owner(identity)
        if (bound && bound !== userId) return reply({ message: 'Account ownership conflict.' }, 409)
        if (!(await claimBrowser(request, body))) return reply({ message: 'Invalid or expired browser challenge.' }, 403)
        await deps.store.bind(identity, userId, principal ? 'owned-session' : 'legacy-session')
        const response = reply({ linked: true })
        setCookie(response, challengeName, '', 0)
        return response
      }
      const store = deps.store
      const linkedUserId = await store.owner(identity)
      let ownerId = linkedUserId
      if (!linkedUserId) {
        const googleSub = identity.provider === 'google.com' ? identity.googleSubject : undefined
        const resolution = resolveLogin({ identity, linkedUserId,
          googleClaim: googleSub && store.googleClaim ? await store.googleClaim(googleSub) : null,
          phoneOwners: identity.phone && store.phoneOwners ? await store.phoneOwners(identity.phone) : [] })
        if (resolution.kind === 'blocked') return reply({ code: 'ACCOUNT_BLOCKED', message: 'This account cannot sign in. Contact support.' }, 403)
        if (resolution.kind === 'phone-ambiguous') return reply({ code: 'PHONE_AMBIGUOUS', message: 'This phone number is shared by more than one account. Contact support for reviewed recovery.' }, 409)
        if (resolution.kind === 'phone-required') {
          if (!store.issuePending) return reply({ code: 'ACCOUNT_LINK_REQUIRED', message: 'Link your existing account or request reviewed recovery.' }, 409)
          if (!(await claimBrowser(request, body))) return reply({ message: 'Invalid or expired browser challenge.' }, 403)
          const pending = await store.issuePending(identity)
          // The Google identity waits 10 minutes for a verified phone; it grants nothing yet.
          const response = reply({ code: 'phone_required', message: 'Confirm your phone number to finish signing in with Google.' }, 409)
          setCookie(response, pendingName, pending, 600); setCookie(response, challengeName, '', 0)
          return response
        }
        if (resolution.kind !== 'bind') return reply({ code: 'ACCOUNT_LINK_REQUIRED', message: 'Link your existing account or request reviewed recovery.' }, 409)
        if (!(await claimBrowser(request, body))) return reply({ message: 'Invalid or expired browser challenge.' }, 403)
        await store.bind(identity, resolution.userId, resolution.proof)
        ownerId = resolution.userId
      } else if (!(await claimBrowser(request, body))) return reply({ message: 'Invalid or expired browser challenge.' }, 403)
      if (ownerId && identity.provider === 'phone') {
        // A Google sign-in that waited for this phone joins the account the phone just proved.
        const token = cookie(request, pendingName)
        const pending = token && OPAQUE.test(token) && store.takePending ? await store.takePending(token) : null
        if (pending && store.bindPendingGoogle) await store.bindPendingGoogle(pending, ownerId).catch(() => false)
      }
      const next = await store.createSession(identity)
      try {
        const old = cookie(request, sessionName)
        if (old && OPAQUE.test(old)) await deps.store.logout(old)
        const response = reply({ authenticated: true })
        setCookie(response, sessionName, next.token, Math.max(0, Math.floor((next.expiresAt.getTime() - Date.now()) / 1000)))
        setCookie(response, challengeName, '', 0)
        if (cookiePresent(request, pendingName)) setCookie(response, pendingName, '', 0)
        return response
      } catch {
        await deps.store.logout(next.token).catch(() => {})
        throw new Error('Session rotation failed')
      }
    } catch {
      return reply({ message: 'Identity verification is temporarily unavailable.' }, 503)
    }
  }
}
