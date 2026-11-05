'use client'

import { useEffect, useRef, useState } from 'react'
import { googleProof, phoneProof, type IdentityWebConfig } from '@/lib/auth/identity-browser'
import { requireLoginAuthority } from '@/lib/auth/browser-login-authority'
import { ownedLoginDestination } from '@/lib/auth/browser-owned-login'
import Link from 'next/link'

export default function NativeRegister({ config, customer, next }: { config: IdentityWebConfig; customer: boolean; next: string }) {
  const [name,setName] = useState(''), [phone,setPhone] = useState(''), [code,setCode] = useState('')
  const [busy,setBusy] = useState(false), [sent,setSent] = useState(false), [error,setError] = useState('')
  const pending = useRef(false), container = useRef<HTMLDivElement>(null)
  const attempt = useRef<Awaited<ReturnType<typeof phoneProof>> | null>(null)
  useEffect(() => () => attempt.current?.cancel(), [])
  async function post(operation: string, body: object) {
    const response = await fetch(`/api/identity/${operation}`, { method: 'POST',credentials: 'same-origin',cache: 'no-store',redirect: 'error',
      headers: { 'Content-Type': 'application/json' },body: JSON.stringify(body) })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message || 'Registration is temporarily unavailable.')
    return data
  }
  async function run(action: () => Promise<void>) {
    if (pending.current) return
    pending.current = true; setBusy(true); setError('')
    try {
      await requireLoginAuthority('owned')
      if (!name.trim()) throw new Error('Enter your full name first.')
      await action()
    } catch (error) { setError(error instanceof Error ? error.message : 'Verification failed. Try again.') }
    finally { pending.current = false; setBusy(false) }
  }
  async function complete(idToken: string) {
    const { challenge } = await post('challenge',{})
    await post(customer ? 'register-customer' : 'register-business',{ idToken,challenge,name })
    window.location.assign(await ownedLoginDestination(customer ? next : '/onboarding',fetch,customer))
  }
  const field = 'w-full rounded-xl border border-white/15 bg-zinc-950 px-4 py-3 text-white disabled:opacity-50'
  const button = 'w-full rounded-full bg-primary px-5 py-3 font-bold text-primary-foreground disabled:opacity-50'
  return <main className="grid min-h-screen place-items-center bg-zinc-950 px-5 py-10 text-white">
    <section aria-labelledby="register-title" className="w-full max-w-sm space-y-5 rounded-3xl border border-white/10 bg-zinc-900/60 p-6 sm:p-8">
      <Link href="/" className="font-black">XmartMenu</Link>
      <h1 id="register-title" className="text-2xl font-bold">{customer ? 'Create your customer account' : 'Create your business account'}</h1>
      <p className="text-sm leading-6 text-zinc-400">Verify your phone by SMS, or use Google to create a new account.</p>
      <label htmlFor="register-name" className="block text-sm font-semibold">Full name</label>
      <input id="register-name" autoComplete="name" maxLength={120} required value={name} onChange={event => setName(event.target.value)} disabled={busy || sent} className={field} />
      {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); void run(async () => {
        if (sent) {
          const verification = attempt.current
          if (!verification) throw new Error('Request a new verification code.')
          attempt.current = null; setSent(false)
          await complete(await verification.confirm(code))
        } else {
          if (!container.current) throw new Error('Reload and try again.')
          attempt.current = await phoneProof(config,phone,container.current); setSent(true)
        }
      }) }}>
        <label htmlFor="register-phone" className="block text-sm font-semibold">Phone with country code</label>
        <input id="register-phone" type="tel" autoComplete="tel" placeholder="+10000000000" value={phone} onChange={event => setPhone(event.target.value)} disabled={busy || sent} required className={field} />
        <div ref={container} />
        {sent ? <><label htmlFor="register-code" className="block text-sm font-semibold">SMS verification code</label>
          <input id="register-code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value)} disabled={busy} required className={field} /></> : null}
        <button disabled={busy} className={button}>{busy ? 'Verifying…' : sent ? 'Verify and create account' : 'Send verification code'}</button>
        {sent ? <button type="button" disabled={busy} onClick={() => { attempt.current?.cancel(); attempt.current = null; setSent(false); setCode('') }} className="w-full text-sm underline">Use another number</button> : null}
      </form>
      <button type="button" disabled={busy || sent} onClick={() => void run(async () => complete(await googleProof(config)))} className={button}>Create account with Google</button>
      <p className="text-sm text-zinc-400">Already have an account? <Link className="text-white underline" href={`/auth/login?from=${encodeURIComponent(next)}${customer ? '&flow=customer' : ''}`}>Sign in</Link> or <Link className="text-white underline" href="/auth/login?action=existing-account-link">link your existing account</Link>.</p>
    </section>
  </main>
}
