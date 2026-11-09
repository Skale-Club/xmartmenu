import type { Auth, RecaptchaVerifier as Captcha } from 'firebase/auth'

export type IdentityWebConfig = { apiKey: string; projectId: string; authDomain: string }
let authentication: { key: string; promise: Promise<Auth> } | undefined

async function checkedConfig(config: IdentityWebConfig) {
  const response = await fetch('/api/identity/config', { credentials: 'same-origin', cache: 'no-store', redirect: 'error' })
  if (!response.ok) throw new Error('Identity project configuration could not be verified')
  const checked = await response.json() as IdentityWebConfig
  if (checked.apiKey !== config.apiKey || checked.projectId !== config.projectId || checked.authDomain !== config.authDomain) throw new Error('Identity project configuration changed')
}

async function client(config: IdentityWebConfig) {
  // Recheck the live flag/config before every mutable action, even when the
  // SDK was initialized by an earlier action in this tab.
  await checkedConfig(config)
  const key = JSON.stringify(config)
  if (authentication?.key === key) return authentication.promise
  const promise = (async () => {
    // Validate key-to-project ownership before importing/initializing any SDK
    // that can create an account or send SMS. Merely labelling a key DEV is not proof.
    const [app, sdk] = await Promise.all([import('firebase/app'), import('firebase/auth')])
    const name = `xmartmenu-identity-${config.projectId}`
    const existing = app.getApps().find(candidate => candidate.name === name)
    if (existing && existing.options.apiKey !== config.apiKey) throw new Error('Reload to use the updated sign-in configuration')
    const instance = existing ?? app.initializeApp(config, name)
    const auth = sdk.getAuth(instance)
    await sdk.setPersistence(auth, sdk.inMemoryPersistence)
    return auth
  })().catch(error => { if (authentication?.key === key) authentication = undefined; throw error })
  authentication = { key, promise }
  return promise
}

export async function googleProof(config: IdentityWebConfig): Promise<string> {
  const auth = await client(config)
  const sdk = await import('firebase/auth')
  try { return await (await sdk.signInWithPopup(auth, new sdk.GoogleAuthProvider())).user.getIdToken() }
  finally { await sdk.signOut(auth) }
}

/**
 * Sends the SMS code. As in Xpot: an invisible reCAPTCHA on its own element at the end of <body>, cleared as
 * soon as the code is sent. The visible checkbox never showed inside the sign-in popup, so the request left
 * without a solved challenge and Google answered auth/invalid-app-credential.
 */
export async function phoneProof(config: IdentityWebConfig, phone: string) {
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error('Include + and the full country code.')
  const auth = await client(config)
  const sdk = await import('firebase/auth')
  const node = document.createElement('div')
  document.body.appendChild(node)
  const captcha: Captcha = new sdk.RecaptchaVerifier(auth, node, { size: 'invisible' })
  let confirmation: Awaited<ReturnType<typeof sdk.signInWithPhoneNumber>>
  try { confirmation = await sdk.signInWithPhoneNumber(auth, phone, captcha) }
  finally { captcha.clear(); node.remove() }
  return {
    cancel: () => { void sdk.signOut(auth).catch(() => {}) },
    confirm: async (code: string) => {
      try { await checkedConfig(config); return await (await confirmation.confirm(code)).user.getIdToken() }
      finally { await sdk.signOut(auth) }
    },
  }
}
