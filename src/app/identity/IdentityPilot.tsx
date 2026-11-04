'use client'

import { useEffect, useRef, useState } from 'react'
import { googleProof, phoneProof, type IdentityWebConfig } from '@/lib/auth/identity-browser'
import { requireLoginAuthority } from '@/lib/auth/browser-login-authority'
import { completeOwnedLogin, ownedLoginDestination } from '@/lib/auth/browser-owned-login'
import Link from 'next/link'

class IdentityRequestError extends Error {}

async function post(operation: string, body: object, legacyToken?: string) {
  const response = await fetch(`/api/identity/${operation}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(legacyToken ? { Authorization: `Bearer ${legacyToken}` } : {}) }, body: JSON.stringify(body) })
  const result = await response.json()
  if (!response.ok) throw new IdentityRequestError(result.message || 'Could not complete sign-in.')
  return result
}

export default function IdentityPilot({ config, continueToApp = false, existingAccountLink = false, next = '/' }: {
  config: IdentityWebConfig; continueToApp?: boolean; existingAccountLink?: boolean; next?: string
}) {
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [link, setLink] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [existingEmail, setExistingEmail] = useState('')
  const [existingPassword, setExistingPassword] = useState('')
  const container = useRef<HTMLDivElement>(null)
  const attempt = useRef<Awaited<ReturnType<typeof phoneProof>> | null>(null)
  const pending = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/identity/session', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(response => { if (!controller.signal.aborted) setSignedIn(response.ok) }).catch(() => {})
    return () => { controller.abort(); attempt.current?.cancel() }
  }, [])

  async function run(action: () => Promise<void>) {
    if (pending.current) return
    pending.current = true; setBusy(true); setError('')
    try {
      await requireLoginAuthority(continueToApp ? 'owned' : 'legacy')
      await action()
    }
    catch (error) { setError(error instanceof IdentityRequestError ? error.message : 'Could not complete verification. Check your details and try again. If the problem continues, contact support.') }
    finally { pending.current = false; setBusy(false) }
  }

  function requireExistingCredentials() {
    if (existingAccountLink && (!existingEmail.trim() || !existingPassword)) throw new IdentityRequestError('Enter your previous account email and password first.')
  }

  async function complete(idToken: string) {
    if (continueToApp) {
      try {
        const destination = await completeOwnedLogin(idToken,{ next,link,
          ...(existingAccountLink ? { existing: { email: existingEmail.trim(),password: existingPassword } } : {}) })
        setSignedIn(true); window.location.assign(destination)
      } catch (error) { throw new IdentityRequestError(error instanceof Error ? error.message : 'Your access could not be confirmed.') }
      finally { setExistingPassword('') }
      return
    }
    if (existingAccountLink) {
      try {
        const { challenge } = await post('challenge', {})
        await post('existing-account-link', { idToken,challenge,email: existingEmail.trim(),password: existingPassword })
        const fresh = await post('challenge', {})
        await post('login', { idToken,challenge: fresh.challenge })
        setSignedIn(true)
        setMessage('Your sign-in method is linked and you are signed in. Your existing access has been preserved.')
        return
      } finally { setExistingPassword('') }
    }
    let legacyToken: string | undefined
    if (link && !signedIn) {
      await requireLoginAuthority('legacy')
      const { createClient } = await import('@/lib/supabase/client')
      const { data } = await createClient().auth.getSession()
      legacyToken = data.session?.access_token
      if (!legacyToken) throw new IdentityRequestError('Sign in to your existing account first, then return here to link this sign-in method.')
    }
    const { challenge } = await post('challenge', {})
    await post(link ? 'link' : 'login', { idToken, challenge }, legacyToken)
    if (link) { setLink(false); setMessage('Your sign-in method is linked. Your existing company access has been preserved.') }
    else { setSignedIn(true); setMessage('You are signed in securely.') }
  }

  async function continueToDashboard() {
    try { window.location.assign(await ownedLoginDestination(next)) }
    catch { throw new IdentityRequestError('Your access could not be confirmed. Try again or contact support for reviewed recovery.') }
  }

  const field = 'w-full rounded-xl border border-white/15 bg-zinc-950 px-4 py-3 text-white outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 disabled:opacity-50'
  const button = 'w-full rounded-full bg-primary px-5 py-3 font-bold text-primary-foreground transition-colors hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary disabled:opacity-50'

  return <main className="grid min-h-screen place-items-center bg-zinc-950 px-5 py-10 text-white">
    <section aria-labelledby="identity-title" className="w-full max-w-sm rounded-3xl border border-white/10 bg-zinc-900/60 p-6 sm:p-8">
      <p className="mb-6 text-sm font-black tracking-wide">XmartMenu</p>
      <h1 id="identity-title" className="text-2xl font-bold tracking-tight">{existingAccountLink ? 'Link your existing account' : 'Sign in with your phone'}</h1>
      <p className="mt-2 text-sm leading-6 text-zinc-400">{existingAccountLink ? 'Prove your previous account, then verify a phone number or Google account. Your company access stays unchanged.' : 'Verify your number by SMS, or continue with Google.'}</p>
      {error ? <p role="alert" className="mt-5 text-sm leading-6 text-red-300">{error}</p> : null}
      {message ? <p role="status" className="mt-5 text-sm leading-6 text-emerald-300">{message}</p> : null}
      {existingAccountLink ? <div className="mt-6 space-y-3">
        <label htmlFor="existing-email" className="block text-sm font-semibold">Previous account email</label>
        <input id="existing-email" type="email" autoComplete="username" maxLength={320} value={existingEmail} onChange={event => setExistingEmail(event.target.value)} disabled={busy} className={field} />
        <label htmlFor="existing-password" className="block text-sm font-semibold">Previous account password</label>
        <input id="existing-password" type="password" autoComplete="current-password" maxLength={4096} value={existingPassword} onChange={event => setExistingPassword(event.target.value)} disabled={busy} className={field} />
      </div> : null}
      <form className="mt-6 space-y-4" onSubmit={event => { event.preventDefault(); void run(async () => {
        requireExistingCredentials()
        if (sent) {
          const current = attempt.current
          if (!current) throw new Error('Request another verification code.')
          try { await complete(await current.confirm(code)) }
          finally { attempt.current = null; setSent(false); setCode('') }
        } else {
          if (!container.current) return
          attempt.current = await phoneProof(config, phone.replace(/[\s()-]/g, ''), container.current)
          setSent(true); setMessage('A verification code was sent to your phone.')
        }
      }) }}>
        <label htmlFor="identity-phone" className="block text-sm font-semibold">Phone number</label>
        <input id="identity-phone" data-testid="identity-phone" className={field} type="tel" autoComplete="tel" placeholder="+1 555 123 4567" required value={phone} onChange={event => setPhone(event.target.value)} disabled={busy || sent} />
        <div ref={container} />
        {sent ? <>
          <label htmlFor="identity-code" className="block text-sm font-semibold">Verification code</label>
          <input id="identity-code" className={field} inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={event => setCode(event.target.value)} disabled={busy} />
        </> : null}
        <button data-testid="identity-phone-submit" className={button} disabled={busy}>{busy ? 'Please wait…' : sent ? 'Verify and continue' : 'Send verification code'}</button>
      </form>
      <button className={`${button} mt-4 border border-white/15 bg-transparent text-white hover:bg-white/5`} disabled={busy || sent} onClick={() => void run(async () => { requireExistingCredentials(); await complete(await googleProof(config)) })}>Continue with Google</button>
      {!existingAccountLink && (!continueToApp || signedIn) ? <label className="mt-6 flex items-start gap-3 text-sm leading-5 text-zinc-400">
        <input className="mt-1 accent-primary" type="checkbox" checked={link} onChange={event => setLink(event.target.checked)} disabled={busy} />
        Link this sign-in method to my existing signed-in account
      </label> : null}
      {continueToApp && !existingAccountLink ? <Link className="mt-6 block text-sm font-semibold text-zinc-300 underline underline-offset-4" href="/auth/login?action=existing-account-link">Link an existing account with your previous password</Link> : null}
      {continueToApp ? <p className="mt-4 text-xs leading-5 text-zinc-500">If your account requires recovery or no longer has access to its previous sign-in, contact support for reviewed recovery.</p> : null}
      {signedIn ? <div className="mt-6 space-y-3 border-t border-white/10 pt-5">
        {continueToApp ? <button className={button} disabled={busy} onClick={() => void run(continueToDashboard)}>Continue to your account</button> : null}
        <button className="w-full text-sm font-semibold text-zinc-300 hover:text-white disabled:opacity-50" disabled={busy} onClick={() => void run(async () => { await post('logout', {}); setSignedIn(false); setMessage('You are signed out.') })}>Sign out</button>
        <button className="w-full text-sm font-semibold text-zinc-400 hover:text-white disabled:opacity-50" disabled={busy} onClick={() => void run(async () => { await post('revoke-all', {}); setSignedIn(false); setMessage('All your sessions have been signed out.') })}>Sign out all devices</button>
      </div> : null}
    </section>
  </main>
}
