'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { googleProof, phoneProof, type IdentityWebConfig } from '@/lib/auth/identity-browser'
import { requireLoginAuthority } from '@/lib/auth/browser-login-authority'
import { completeOwnedLogin, ownedLoginDestination, OwnedLoginError } from '@/lib/auth/browser-owned-login'
import Link from 'next/link'
import { ArrowRight, ChevronLeft } from 'lucide-react'
import type { GuestBrand } from '@/lib/auth/guest-brand'
import GuestSignInHeader from '@/components/auth/GuestSignInHeader'
import PhoneField from '@/components/ui/PhoneField'
import { keepFieldVisible } from '@/components/ui/keyboard-fields'
import { computePrimaryForeground } from '@/lib/color-utils'
import { fill, getMenuCopy, localeFor } from '@/components/menu/menu-i18n'
import { phoneLabel, toE164Phone } from '@/components/menu/showcase'
import { DEV_PHONE_SIGN_IN, devPhoneStart, devPhoneVerify } from '@/lib/auth/dev-phone-client'

const noSubscription = () => () => {}
const readPlatformLogo = () => {
  const url = (window as unknown as { __LOGO_URL__?: unknown }).__LOGO_URL__
  return typeof url === 'string' && url ? url : null
}

class IdentityRequestError extends Error { constructor(message: string, readonly code?: string) { super(message) } }

async function post(operation: string, body: object, legacyToken?: string) {
  const response = await fetch(`/api/identity/${operation}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(legacyToken ? { Authorization: `Bearer ${legacyToken}` } : {}) }, body: JSON.stringify(body) })
  const result = await response.json()
  if (!response.ok) throw new IdentityRequestError(result.message || 'Could not complete sign-in.')
  return result
}

/** Display only: the server verifies the token. Never used for any decision. */
function googleEmail(token: string): string {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { email?: unknown }
    return typeof payload.email === 'string' ? payload.email.slice(0, 254) : 'this Google account'
  } catch { return 'this Google account' }
}

export default function IdentityPilot({ config, continueToApp = false, existingAccountLink = false, next = '/',customerFlow = false,linkCurrentAccount = false,staffAccess,embedded = false,brand = null }: {
  config: IdentityWebConfig; continueToApp?: boolean; existingAccountLink?: boolean; next?: string; customerFlow?: boolean; linkCurrentAccount?: boolean; staffAccess?: {kind:'invite'|'recovery';code:string}
  /** Inside the menu's sign-in popup (a same-origin frame): no full-screen page, no card border; the popup is the card. */
  embedded?: boolean
  /** The restaurant the guest signs in from (embedded customer sign-in): its look, country and language. */
  brand?: GuestBrand | null
}) {
  const [phone, setPhone] = useState('')
  /** Branded sign-in: the number the code went to, shown while the code is typed. */
  const [sentPhone, setSentPhone] = useState('')
  // The platform logo the auth layout publishes (window.__LOGO_URL__), read after mount to keep hydration stable.
  const platformLogo = useSyncExternalStore(noSubscription, readPlatformLogo, () => null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [link, setLink] = useState(linkCurrentAccount)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [googleAttempted, setGoogleAttempted] = useState(false)
  const [confirmLink, setConfirmLink] = useState<{ token: string; email: string } | null>(null)
  const [existingEmail, setExistingEmail] = useState('')
  const [existingPassword, setExistingPassword] = useState('')
  const container = useRef<HTMLDivElement>(null)
  const attempt = useRef<Awaited<ReturnType<typeof phoneProof>> | null>(null)
  const pending = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/identity/session', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(response => {
        if (controller.signal.aborted) return
        // A plain sign-in with a live session has nothing to ask: go straight to where it leads.
        if (response.ok && continueToApp && !link && !staffAccess && !existingAccountLink) { void continueToDashboard().catch(() => setSignedIn(true)); return }
        setSignedIn(response.ok)
      }).catch(() => {})
    return () => { controller.abort(); attempt.current?.cancel() }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one session check when the page opens
  }, [])

  async function run(action: () => Promise<void>) {
    if (pending.current) return
    pending.current = true; setBusy(true); setError('')
    try {
      await requireLoginAuthority(continueToApp ? 'owned' : 'legacy')
      await action()
    }
    catch (error) {
      // Development: the provider's own error (e.g. auth/invalid-app-credential) behind the generic message.
      if (process.env.NODE_ENV === 'development') console.error('[dev identity] sign-in step failed:', error)
      if (error instanceof IdentityRequestError && error.code === 'phone_required') {
        // Google alone does not open an account: confirm the phone, which finishes the Google link.
        setGoogleAttempted(true)
        setMessage('Google confirmed. Verify your phone number first; you can then link Google to your account.'); setError(''); document.getElementById('identity-phone')?.focus(); return
      }
      setError(error instanceof IdentityRequestError ? error.message : 'Could not complete verification. Check your details and try again. If the problem continues, contact support.')
    }
    finally { pending.current = false; setBusy(false) }
  }

  function requireExistingCredentials() {
    if (existingAccountLink && (!existingEmail.trim() || !existingPassword)) throw new IdentityRequestError('Enter your previous account email and password first.')
  }

  async function complete(idToken: string) {
    if (staffAccess) {
      const { challenge } = await post('challenge',{})
      await post(staffAccess.kind === 'invite' ? 'accept-staff-invite' : 'recover-staff',{idToken,challenge,code:staffAccess.code})
      setSignedIn(true);window.location.assign(await ownedLoginDestination('/dashboard'));return
    }
    if (continueToApp) {
      try {
        const destination = await completeOwnedLogin(idToken,{ next,link,customerFlow,
          ...(existingAccountLink ? { existing: { email: existingEmail.trim(),password: existingPassword } } : {}) })
        setSignedIn(true)
        // Google that waited for a phone is linked afterwards, from this fresh session, after showing which Google account it is.
        window.location.assign(googleAttempted && !link
          ? `/identity?action=link${customerFlow ? '&flow=customer' : ''}&from=${encodeURIComponent(destination)}` : destination)
      } catch (error) { throw new IdentityRequestError(error instanceof Error ? error.message : 'Your access could not be confirmed.', error instanceof OwnedLoginError ? error.code : undefined) }
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
    try { window.location.assign(await ownedLoginDestination(next,fetch,customerFlow)) }
    catch { throw new IdentityRequestError('Your access could not be confirmed. Try again or contact support for reviewed recovery.') }
  }

  const field = 'w-full rounded-xl border border-white/15 bg-zinc-950 px-4 py-3 text-white outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 disabled:opacity-50'
  const button = 'w-full rounded-full bg-primary px-5 py-3 font-bold text-primary-foreground transition-colors hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary disabled:opacity-50'


  // ── Inside a restaurant's menu: the guest sign-in in the restaurant's look, language and country.
  if (brand && embedded && continueToApp && customerFlow && !existingAccountLink && !staffAccess) {
    const copy = getMenuCopy(brand.lang)
    const accent = brand.primaryColor
    const onAccent = computePrimaryForeground(accent)
    const context = { country: brand.country, currency: brand.currency }
    const brandQuery = `&embed=1&tenant=${encodeURIComponent(brand.slug)}&lang=${encodeURIComponent(brand.lang)}`
    const fieldClass = 'block h-12 w-full rounded-xl border border-zinc-300 bg-white px-4 text-[16px] text-zinc-950 placeholder:text-zinc-500 transition-[border-color,box-shadow] focus:border-[var(--accent)] focus:outline-none focus:ring-[3px] focus:ring-[color-mix(in_srgb,var(--accent)_22%,transparent)] disabled:bg-zinc-50'
    const primary = 'flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[16px] font-semibold transition-[scale,filter] active:scale-[0.98] enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50'
    const accentStyle = { backgroundColor: accent, color: onAccent }
    const label = 'mb-1.5 block text-[14px] font-medium text-zinc-700'
    const submit = () => void run(async () => {
      // Development on localhost: Xpot's development code instead of SMS (dev-phone-client.ts).
      if (DEV_PHONE_SIGN_IN) {
        if (sent) {
          await devPhoneVerify(sentPhone, code)
          window.location.assign(await ownedLoginDestination(next, fetch, customerFlow))
          return
        }
        const devPhone = toE164Phone(phone)
        if (!devPhone) throw new IdentityRequestError('Check the number and the selected country.')
        const devCode = await devPhoneStart(devPhone)
        setSentPhone(devPhone); setSent(true); setCode(devCode)
        setMessage(`Development code: ${devCode}. We filled it in for you.`)
        return
      }
      if (sent) {
        const current = attempt.current
        if (!current) throw new IdentityRequestError('Request another verification code.')
        try { await complete(await current.confirm(code)) }
        finally { attempt.current = null; setSent(false); setCode('') }
        return
      }
      const e164 = toE164Phone(phone)
      if (!e164) throw new IdentityRequestError(copy.loginInvalidPhone)
      if (!container.current) return
      attempt.current = await phoneProof(config, e164)
      setSentPhone(e164); setSent(true); setMessage('')
    })
    return <main className="bg-white text-zinc-950" style={{ '--accent': accent } as React.CSSProperties}>
      <style>{'html,body{background:#fff;color-scheme:light}'}</style>
      <section aria-labelledby="identity-title">
        <GuestSignInHeader bannerUrl={brand.bannerUrl} logoUrl={brand.logoUrl} restaurantName={brand.name} accent={accent} onAccent={onAccent}
          title={sent ? copy.loginVerifyTitle : copy.loginTitle}
          subtitle={sent ? fill(copy.loginCodeSent, { phone: phoneLabel(sentPhone, context) || sentPhone }) : copy.loginSubtitle} />
        <div className="space-y-4 px-6 pb-6 pt-5">
          {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[14px] font-medium leading-snug text-red-800">{error}</p> : null}
          {message ? <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[14px] font-medium leading-snug text-emerald-800">{message}</p> : null}
          <form className="space-y-4" onSubmit={event => { event.preventDefault(); submit() }}>
            {sent ? <div>
              <label htmlFor="identity-code" className={label}>{copy.loginCodeLabel}</label>
              <input id="identity-code" className={`${fieldClass} text-center text-[22px] font-semibold tracking-[0.4em] tabular-nums`} inputMode="numeric" autoComplete="one-time-code"
                enterKeyHint="done" pattern="[0-9]*" maxLength={6} placeholder="000000" required autoFocus value={code}
                onChange={event => setCode(event.target.value.replace(/\D/g, ''))} onFocus={keepFieldVisible} disabled={busy} />
            </div> : <div>
              <label htmlFor="identity-phone" className={label}>{copy.loginPhoneLabel}</label>
              <PhoneField ghost id="identity-phone" value={phone} onChange={setPhone} phoneContext={context} locale={localeFor(brand.lang)}
                countryLabel={copy.loginCountry} countrySearchLabel={copy.loginCountrySearch} enterKeyHint="send" autoFocus required
                onFocus={keepFieldVisible} className={fieldClass} />
            </div>}
            <div ref={container} />
            <button data-testid="identity-phone-submit" className={primary} style={accentStyle}
              disabled={busy || (sent ? code.length < 6 : phone.replace(/\D/g, '').length < 6)}>
              {busy ? (sent ? copy.loginVerifying : copy.loginSending) : sent ? copy.loginVerify : <>{copy.loginSendCode}<ArrowRight className="size-4" aria-hidden="true" /></>}
            </button>
            {sent ? <button type="button" disabled={busy}
              onClick={() => { attempt.current?.cancel(); attempt.current = null; setSent(false); setCode(''); setError('') }}
              className="mx-auto flex h-11 items-center justify-center gap-1 rounded-lg px-3 text-[15px] font-medium text-zinc-700 underline-offset-4 hover:text-zinc-950 hover:underline">
              <ChevronLeft className="size-4" aria-hidden="true" /> {copy.loginChangePhone}
            </button> : null}
          </form>
          {!sent ? <>
            <div className="flex items-center gap-3 text-[13px] font-medium text-zinc-500" aria-hidden="true">
              <span className="h-px flex-1 bg-zinc-200" />{copy.loginOr}<span className="h-px flex-1 bg-zinc-200" />
            </div>
            <button type="button" disabled={busy} onClick={() => void run(async () => { await complete(await googleProof(config)) })}
              className="flex h-12 w-full items-center justify-center gap-2.5 rounded-xl border border-zinc-300 bg-white text-[16px] font-semibold text-zinc-900 transition-colors hover:bg-zinc-50 disabled:opacity-50">
              <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.77.43 3.45 1.18 4.94l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/></svg>
              {copy.loginGoogle}
            </button>
            <Link className="block text-[14px] font-medium leading-snug text-zinc-700 underline underline-offset-4 hover:text-zinc-950"
              href={`/auth/login?action=existing-account-link&flow=customer&from=${encodeURIComponent(next)}${brandQuery}`}>{copy.loginExistingAccount}</Link>
            <p className="text-[13px] leading-snug text-zinc-600">{copy.loginRecovery}</p>
          </> : null}
        </div>
      </section>
    </main>
  }


  // ── Inside the marketing site's popup: the platform sign-in on the site's own dark card (logo, Google first,
  // then the phone with its country), so nobody leaves the page to sign in.
  if (embedded && !brand && continueToApp && !customerFlow && !existingAccountLink && !staffAccess) {
    const fieldClass = 'block h-12 w-full rounded-xl border border-white/10 bg-white/5 px-4 text-[16px] text-white placeholder:text-zinc-500 transition-[border-color,box-shadow] focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50'
    const primary = 'flex h-14 w-full items-center justify-center gap-2 rounded-full bg-primary text-base font-black text-primary-foreground transition-all enabled:hover:scale-[1.02] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50'
    const label = 'mb-2 ml-1 block text-[11px] font-bold uppercase tracking-widest text-zinc-400'
    const submit = () => void run(async () => {
      // Development on localhost: Xpot's development code instead of SMS (dev-phone-client.ts).
      if (DEV_PHONE_SIGN_IN) {
        if (sent) {
          await devPhoneVerify(sentPhone, code)
          window.location.assign(await ownedLoginDestination(next, fetch, customerFlow))
          return
        }
        const devPhone = toE164Phone(phone)
        if (!devPhone) throw new IdentityRequestError('Check the number and the selected country.')
        const devCode = await devPhoneStart(devPhone)
        setSentPhone(devPhone); setSent(true); setCode(devCode)
        setMessage(`Development code: ${devCode}. We filled it in for you.`)
        return
      }
      if (sent) {
        const current = attempt.current
        if (!current) throw new IdentityRequestError('Request another verification code.')
        try { await complete(await current.confirm(code)) }
        finally { attempt.current = null; setSent(false); setCode('') }
        return
      }
      const e164 = toE164Phone(phone)
      if (!e164) throw new IdentityRequestError('Check the number and the selected country.')
      if (!container.current) return
      attempt.current = await phoneProof(config, e164)
      setSentPhone(e164); setSent(true); setMessage('')
    })
    return <main className="relative overflow-hidden bg-zinc-900 px-6 pb-6 pt-8 text-white" style={{ colorScheme: 'dark' }}>
      {/* The frame's page must share the card's colour and scheme, or the browser paints a white backdrop
          behind it that shows as a light edge around the popup. */}
      <style>{'html,body{background:#18181b;color-scheme:dark}'}</style>
      {/* Soft brand glow under the popup's gradient top line. */}
      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-0 h-24 w-48 -translate-x-1/2 rounded-full bg-[#F52323]/10 blur-3xl" />
      <section aria-labelledby="identity-title" className="relative">
        <div className="mb-8 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element -- platform logo URL from settings; any host. */}
          {platformLogo ? <img src={platformLogo} alt="" className="mx-auto mb-5 size-12 object-contain" /> : <span aria-hidden="true" className="mx-auto mb-5 block size-12 rounded-xl bg-primary" />}
          <h1 id="identity-title" className="text-2xl font-black tracking-tight">XmartMenu</h1>
          <p className="mt-2 text-sm font-bold text-zinc-400">{sent ? `Enter the code we sent to ${phoneLabel(sentPhone) || sentPhone}` : 'Sign in to your menu dashboard'}</p>
        </div>
        {error ? <p role="alert" className="mb-4 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-[14px] font-medium leading-snug text-red-200">{error}</p> : null}
        {message ? <p role="status" className="mb-4 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-[14px] font-medium leading-snug text-emerald-200">{message}</p> : null}
        {sent ? <button type="button" disabled={busy}
          onClick={() => { attempt.current?.cancel(); attempt.current = null; setSent(false); setCode(''); setError('') }}
          className="mb-4 flex min-h-11 items-center gap-1 text-xs font-bold text-zinc-400 transition-colors hover:text-zinc-200">
          <ChevronLeft className="size-3.5" aria-hidden="true" /> Use another number
        </button> : null}
        {/* The phone comes first: it is how the platform signs people in. */}
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); submit() }}>
          {sent ? <div>
            <label htmlFor="identity-code" className={label}>Verification code</label>
            <input id="identity-code" className={`${fieldClass} text-center text-[22px] font-semibold tracking-[0.4em] tabular-nums`} inputMode="numeric" autoComplete="one-time-code"
              enterKeyHint="done" pattern="[0-9]*" maxLength={6} placeholder="000000" required autoFocus value={code}
              onChange={event => setCode(event.target.value.replace(/\D/g, ''))} onFocus={keepFieldVisible} disabled={busy} />
          </div> : <div>
            <label htmlFor="identity-phone" className={label}>Phone</label>
            <PhoneField ghost id="identity-phone" value={phone} onChange={setPhone} tone="dark"
              countryLabel="Country" countrySearchLabel="Search country" enterKeyHint="send" required
              onFocus={keepFieldVisible} className={fieldClass} />
          </div>}
          <div ref={container} />
          <button data-testid="identity-phone-submit" className={primary} disabled={busy || (sent ? code.length < 6 : phone.replace(/\D/g, '').length < 6)}>
            {busy ? 'Please wait…' : sent ? 'Sign in' : 'Continue'}{busy ? null : <ArrowRight className="size-4" aria-hidden="true" />}
          </button>
        </form>
        {!sent ? <>
          <div className="my-6 flex items-center gap-3" aria-hidden="true">
            <div className="h-px flex-1 bg-white/10" />
            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">or</span>
            <div className="h-px flex-1 bg-white/10" />
          </div>
          <button type="button" disabled={busy} onClick={() => void run(async () => { await complete(await googleProof(config)) })}
            className="flex w-full items-center justify-center gap-3 rounded-full border border-white/10 bg-white/5 px-4 py-3.5 text-sm font-bold text-white transition-all hover:scale-[1.02] hover:bg-white/10 active:scale-95 disabled:opacity-50">
            <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.77.43 3.45 1.18 4.94l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/></svg>
            Continue with Google
          </button>
        </> : null}
        <p className="mt-6 px-4 text-center text-[11px] font-medium leading-relaxed text-zinc-500">By signing in, you agree to the platform terms of use and privacy policy.</p>
      </section>
    </main>
  }

  return <main className={embedded ? 'bg-zinc-950 text-white' : 'grid min-h-screen place-items-center bg-zinc-950 px-5 py-10 text-white'}>
    <section aria-labelledby="identity-title" className={embedded ? 'w-full px-6 pb-6 pt-7' : 'w-full max-w-sm rounded-3xl border border-white/10 bg-zinc-900/60 p-6 sm:p-8'}>
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
          attempt.current = await phoneProof(config, phone.replace(/[\s()-]/g, ''))
          setSent(true); setMessage('A verification code was sent to your phone.')
        }
      }) }}>
        <label htmlFor="identity-phone" className="block text-sm font-semibold">Phone number</label>
        <input id="identity-phone" data-testid="identity-phone" className={field} type="tel" autoComplete="tel" placeholder="+1 000 000 0000" required value={phone} onChange={event => setPhone(event.target.value)} disabled={busy || sent} />
        <div ref={container} />
        {sent ? <>
          <label htmlFor="identity-code" className="block text-sm font-semibold">Verification code</label>
          <input id="identity-code" className={field} inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={event => setCode(event.target.value)} disabled={busy} />
        </> : null}
        <button data-testid="identity-phone-submit" className={button} disabled={busy}>{busy ? 'Please wait…' : sent ? 'Verify and continue' : 'Send verification code'}</button>
      </form>
      <button className={`${button} mt-4 border border-white/15 bg-transparent text-white hover:bg-white/5`} disabled={busy || sent} onClick={() => void run(async () => {
        requireExistingCredentials()
        const token = await googleProof(config)
        // Linking: show the Google account first and let the person confirm it is theirs.
        if (linkCurrentAccount && link) { setConfirmLink({ token, email: googleEmail(token) }); return }
        await complete(token)
      })}>Continue with Google</button>
      {confirmLink ? <div role="alertdialog" aria-label="Confirm Google account" className="mt-4 space-y-3 rounded-2xl border border-white/15 p-4">
        <p className="text-sm leading-6">Link <strong>{confirmLink.email}</strong> to your account? Only continue if this is your own Google account.</p>
        <button className={button} disabled={busy} onClick={() => void run(async () => { const token = confirmLink.token; setConfirmLink(null); await complete(token) })}>Link this Google account</button>
        <button className="w-full text-sm font-semibold text-zinc-300 hover:text-white" disabled={busy} onClick={() => setConfirmLink(null)}>Cancel</button>
      </div> : null}
      {!staffAccess && !existingAccountLink && (!continueToApp || signedIn) ? <label className="mt-6 flex items-start gap-3 text-sm leading-5 text-zinc-400">
        <input className="mt-1 accent-primary" type="checkbox" checked={link} onChange={event => setLink(event.target.checked)} disabled={busy} />
        Link this sign-in method to my existing signed-in account
      </label> : null}
      {!staffAccess && continueToApp && !existingAccountLink ? <Link className="mt-6 block text-sm font-semibold text-zinc-300 underline underline-offset-4" href={`/auth/login?action=existing-account-link${customerFlow ? `&flow=customer&from=${encodeURIComponent(next)}${embedded ? '&embed=1' : ''}` : ''}`}>Have an account with e-mail and password? Enter it once to add your phone</Link> : null}
      {continueToApp && linkCurrentAccount ? <Link className="mt-4 block text-sm font-semibold text-zinc-300 underline underline-offset-4"
        href={`/auth/login?flow=customer&from=${encodeURIComponent(`/identity?action=link&flow=customer&from=${encodeURIComponent(next)}`)}`}>Sign in again before linking if your current sign-in is no longer recent</Link> : null}
      {continueToApp ? <p className="mt-4 text-xs leading-5 text-zinc-500">If your account requires recovery or no longer has access to its previous sign-in, contact support for reviewed recovery.</p> : null}
      {signedIn ? <div className="mt-6 space-y-3 border-t border-white/10 pt-5">
        {continueToApp && !staffAccess ? <button className={button} disabled={busy} onClick={() => void run(continueToDashboard)}>Continue to your account</button> : null}
        <button className="w-full text-sm font-semibold text-zinc-300 hover:text-white disabled:opacity-50" disabled={busy} onClick={() => void run(async () => { await post('logout', {}); setSignedIn(false); setMessage('You are signed out.') })}>Sign out</button>
        <button className="w-full text-sm font-semibold text-zinc-400 hover:text-white disabled:opacity-50" disabled={busy} onClick={() => void run(async () => { await post('revoke-all', {}); setSignedIn(false); setMessage('All your sessions have been signed out.') })}>Sign out all devices</button>
      </div> : null}
    </section>
  </main>
}
