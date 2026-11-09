'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ArrowRight, ChevronLeft } from 'lucide-react'
import { readLoginAuthority, requireLoginAuthority, type LoginAuthority } from '@/lib/auth/browser-login-authority'
import Link from 'next/link'
import GuestSignInHeader from '@/components/auth/GuestSignInHeader'
import { computePrimaryForeground, safeCssColor } from '@/lib/color-utils'
import { fill, getMenuCopy, type LoginCopy } from '@/components/menu/menu-i18n'
import { phoneLabel, phoneRegion, toE164Phone, type PhoneContext } from '@/components/menu/showcase'
import PhoneCountryPicker from '@/components/ui/PhoneCountryPicker'
import { AsYouType, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/core'
import metadata from 'libphonenumber-js/min/metadata'

const hasDigits = (value: string) => value.replace(/\D/g, '').length >= 6

interface Props {
  slug: string
  primaryColor: string
  onSuccess?: () => void
  /** The restaurant's logo and name, shown at the top instead of the generic phone badge. */
  logoUrl?: string | null
  restaurantName?: string | null
  /** The menu's language for the texts (English when absent). */
  copy?: LoginCopy
  /** The restaurant's country/currency: the field starts with its calling code and local numbers are read in it. */
  phoneContext?: PhoneContext | null
  /** Little height left (the phone keyboard is up): a smaller header so the field and its button fit together. */
  compact?: boolean
  /** BCP 47 locale for country names in the picker. */
  locale?: string
  /** The restaurant's banner photo, on top of the card like the menu header. */
  bannerUrl?: string | null
}

export default function LoginClient({ slug, primaryColor, onSuccess, logoUrl, restaurantName, copy = getMenuCopy('en'), phoneContext = null, compact = false, locale = 'en', bannerUrl = null }: Props) {
  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  // The restaurant's country first (a US restaurant starts on +1); the field holds the number without it.
  const [country, setCountry] = useState<CountryCode>(() => phoneRegion(phoneContext))
  const [phone, setPhone] = useState('')
  /** The number the code went to, in E.164: what the code is checked against. */
  const [sentPhone, setSentPhone] = useState('')
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [authority,setAuthority] = useState<LoginAuthority | 'unavailable' | null>(null)
  const [nativeSession,setNativeSession] = useState(false)
  useEffect(() => {
    let active = true
    void readLoginAuthority().then(async value => {
      if (value === 'owned') {
        const result = await fetch('/api/identity/session',{ credentials: 'same-origin',cache: 'no-store',redirect: 'error' })
        if (![200,401].includes(result.status)) throw new Error('Sign-in unavailable')
        if (active) setNativeSession(result.ok)
      }
      if (active) setAuthority(value)
    }).catch(() => { if (active) setAuthority('unavailable') })
    return () => { active = false }
  },[])

  async function handleSendOTP() {
    // A local number is read in the restaurant's country; the code goes to the full international number.
    const trimmed = toE164Phone(phone, { country })
    if (!trimmed) {
      setError(copy.loginInvalidPhone)
      return
    }
    setLoading(true)
    setError(null)
    try { await requireLoginAuthority('legacy') }
    catch { setError('Sign-in is unavailable or changed. Reload and try again.'); setLoading(false); return }
    const supabase = createClient()

    const { error: authError } = await supabase.auth.signInWithOtp({
      phone: trimmed,
      options: { channel: 'sms' },
    })

    if (authError) {
      // Phone sign-in needs an SMS provider in Supabase (docs/guest-login.md);
      // until then say so instead of showing the raw provider error.
      const unavailable = authError.code === 'phone_provider_disabled' || /phone.*(provider|disabled|not enabled)|unsupported phone provider/i.test(authError.message)
      setError(unavailable ? copy.loginUnavailable : authError.message)
    } else {
      setSentPhone(trimmed)
      setStep('otp')
    }
    setLoading(false)
  }

  async function handleVerifyOTP() {
    setLoading(true)
    setError(null)
    try { await requireLoginAuthority('legacy') }
    catch { setError('Sign-in is unavailable or changed. Reload and try again.'); setLoading(false); return }
    const supabase = createClient()

    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      phone: sentPhone,
      token: token.trim(),
      type: 'sms',
    })

    if (verifyError) {
      setError(verifyError.message)
      setLoading(false)
      return
    }

    // Upsert customer profile
    if (data.user) {
      await supabase.from('customer_profiles').upsert({
        id: data.user.id,
        phone: data.user.phone ?? sentPhone,
      }, { onConflict: 'id' })
    }

    if (onSuccess) {
      onSuccess()
    } else {
      window.location.href = `/${slug}/me`
    }
  }

  const accent = safeCssColor(primaryColor, '#18181b')
  const onAccent = computePrimaryForeground(accent)
  const btnStyle = { backgroundColor: accent, color: onAccent }

  if (authority !== 'legacy') {
    const current = typeof window === 'undefined' ? `/${slug}` : `${window.location.pathname}${window.location.search}`
    const href = `${nativeSession ? '/identity?action=link&' : '/auth/login?'}flow=customer&from=${encodeURIComponent(current)}`
    return <div className="grid min-h-screen place-items-center bg-zinc-50 px-4"><section className="w-full max-w-sm rounded-2xl bg-white p-8 text-zinc-950 shadow-xl">
      <h1 className="text-2xl font-black">{nativeSession ? 'Verify your phone' : 'Sign in to your account'}</h1>
      {authority === 'owned' ? <><p className="mt-3 text-sm leading-6 text-zinc-500">{nativeSession ? 'Confirm a phone number for your current account. Your existing orders remain yours.' : 'Use your verified phone number or Google account. Phone-only menus require a verified phone.'}</p>
        <Link href={href} className="mt-6 block rounded-full px-5 py-3 text-center font-bold" style={btnStyle}>Continue</Link></>
        : <p role={authority === 'unavailable' ? 'alert' : 'status'} className="mt-4 text-sm text-zinc-500">{authority === 'unavailable' ? 'Sign-in is temporarily unavailable. Reload and try again.' : 'Checking sign-in availability…'}</p>}
    </section></div>
  }

  // In a popup (onSuccess given) the popup is the card: no full-screen page around it.
  const inPopup = !!onSuccess
  const field = 'block h-12 w-full rounded-xl border border-zinc-300 bg-white px-4 text-[16px] text-zinc-950 placeholder:text-zinc-500 transition-[border-color,box-shadow] focus:border-[var(--accent)] focus:outline-none focus:ring-[3px] focus:ring-[color-mix(in_srgb,var(--accent)_22%,transparent)] disabled:bg-zinc-50'
  const primaryButton = 'flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[16px] font-semibold transition-[scale,filter] active:scale-[0.98] enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50'
  // On phones the keyboard opens over the dialog: bring the field being typed into the middle of what is left.
  const keepVisible = (e: React.FocusEvent<HTMLInputElement>) => {
    const input = e.currentTarget
    window.setTimeout(() => input.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300)
  }
  const sentTo = phoneLabel(sentPhone, { country }) || sentPhone
  const asTyped = (digits: string, iso: CountryCode) => (digits ? new AsYouType(iso, metadata).input(digits) : '')
  // Formatted as typed for the chosen country. A pasted "+1 330…" switches the country to match;
  // deleting a bracket or dash deletes the digit before it instead of being put straight back.
  const typePhone = (next: string) => {
    if (next.trim().startsWith('+')) {
      const parsed = parsePhoneNumberFromString(next, metadata)
      // Only a complete, valid number moves the country, so typing "+4…" never flips it halfway.
      if (parsed?.country && parsed.isValid()) { setCountry(parsed.country); setPhone(parsed.formatNational()); return }
      setPhone(next); return
    }
    let digits = next.replace(/\D/g, '')
    if (next.length < phone.length && digits === phone.replace(/\D/g, '')) digits = digits.slice(0, -1)
    setPhone(asTyped(digits, country))
  }
  const chooseCountry = (iso: CountryCode) => {
    setCountry(iso)
    if (!phone.trim().startsWith('+')) setPhone(asTyped(phone.replace(/\D/g, ''), iso))
  }

  return (
    <div className={inPopup ? '' : 'flex min-h-screen items-center justify-center bg-zinc-50 px-4'} style={{ '--accent': accent } as React.CSSProperties}>
      <div className={inPopup ? 'w-full' : 'w-full max-w-sm overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl'}>
        <GuestSignInHeader bannerUrl={bannerUrl} logoUrl={logoUrl} restaurantName={restaurantName} accent={accent} onAccent={onAccent} compact={compact}
          title={step === 'phone' ? copy.loginTitle : copy.loginVerifyTitle}
          // With the keyboard up the phone step drops its intro; where the code went always stays.
          subtitle={compact && step === 'phone' ? null : step === 'phone' ? copy.loginSubtitle : fill(copy.loginCodeSent, { phone: sentTo })} />

        <div className="space-y-4 px-6 pb-6 pt-5">
          {error && (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[14px] font-medium leading-snug text-red-800">
              {error}
            </p>
          )}

          {step === 'phone' ? (
            <form className="space-y-4" onSubmit={e => { e.preventDefault(); void handleSendOTP() }}>
              <div>
                <label htmlFor="guest-phone" className="mb-1.5 block text-[14px] font-medium text-zinc-700">{copy.loginPhoneLabel}</label>
                <div className="flex gap-2">
                  <PhoneCountryPicker
                    value={country}
                    onChange={chooseCountry}
                    label={copy.loginCountry}
                    searchLabel={copy.loginCountrySearch}
                    locale={locale}
                    first={phoneRegion(phoneContext)}
                  />
                  <input
                    id="guest-phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel-national"
                    enterKeyHint="send"
                    value={phone}
                    onChange={e => typePhone(e.target.value)}
                    onFocus={keepVisible}
                    className={`${field} min-w-0 flex-1 tabular-nums`}
                    autoFocus
                  />
                </div>
              </div>
              <button type="submit" disabled={loading || !hasDigits(phone)} className={primaryButton} style={btnStyle}>
                {loading ? copy.loginSending : <>{copy.loginSendCode}<ArrowRight className="size-4" aria-hidden="true" /></>}
              </button>
            </form>
          ) : (
            <form className="space-y-4" onSubmit={e => { e.preventDefault(); void handleVerifyOTP() }}>
              <div>
                <label htmlFor="guest-code" className="mb-1.5 block text-[14px] font-medium text-zinc-700">{copy.loginCodeLabel}</label>
                <input
                  id="guest-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  enterKeyHint="done"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={token}
                  onChange={e => setToken(e.target.value.replace(/\D/g, ''))}
                  onFocus={keepVisible}
                  placeholder="000000"
                  className={`${field} text-center text-[22px] font-semibold tracking-[0.4em] tabular-nums`}
                  autoFocus
                />
              </div>
              <button type="submit" disabled={loading || token.length < 6} className={primaryButton} style={btnStyle}>
                {loading ? copy.loginVerifying : copy.loginVerify}
              </button>
              <button
                type="button"
                onClick={() => { setStep('phone'); setToken(''); setError(null) }}
                className="mx-auto flex h-11 items-center justify-center gap-1 rounded-lg px-3 text-[15px] font-medium text-zinc-700 underline-offset-4 hover:text-zinc-950 hover:underline"
              >
                <ChevronLeft className="size-4" aria-hidden="true" /> {copy.loginChangePhone}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
