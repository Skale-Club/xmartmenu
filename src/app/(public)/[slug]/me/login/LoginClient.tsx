'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Phone, ArrowRight, KeyRound, ChevronLeft } from 'lucide-react'
import { readLoginAuthority, requireLoginAuthority, type LoginAuthority } from '@/lib/auth/browser-login-authority'
import Link from 'next/link'

interface Props {
  slug: string
  primaryColor: string
  onSuccess?: () => void
}

export default function LoginClient({ slug, primaryColor, onSuccess }: Props) {
  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [phone, setPhone] = useState('')
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
    const trimmed = phone.trim()
    if (!trimmed.startsWith('+')) {
      setError('Include your country code, e.g. +1 for US or +55 for Brazil.')
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
      setError(unavailable ? 'Signing in with your phone is not available yet. Please ask the staff for help.' : authError.message)
    } else {
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
      phone: phone.trim(),
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
        phone: data.user.phone ?? phone.trim(),
      }, { onConflict: 'id' })
    }

    if (onSuccess) {
      onSuccess()
    } else {
      window.location.href = `/${slug}/me`
    }
  }

  const btnStyle = { backgroundColor: primaryColor, color: '#09090b' }

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

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-xl border border-zinc-100 overflow-hidden">
          <div className="p-8 text-center" style={{ backgroundColor: primaryColor + '20' }}>
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: primaryColor }}>
              <Phone className="w-7 h-7" style={{ color: '#09090b' }} />
            </div>
            <h1 className="text-2xl font-black text-zinc-950 tracking-tight">
              {step === 'phone' ? 'Sign In' : 'Verify Phone'}
            </h1>
            <p className="text-sm text-zinc-500 mt-1 font-medium">
              {step === 'phone'
                ? 'Enter your phone number to receive a one-time code'
                : `We sent a code to ${phone}`}
            </p>
          </div>

          <div className="p-8 space-y-5">
            {error && (
              <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm font-bold text-red-600">
                {error}
              </div>
            )}

            {step === 'phone' ? (
              <>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Phone Number</label>
                  <div className="relative">
                    <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                    <input
                      type="tel"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleSendOTP()}
                      placeholder="+1 000 000 0000"
                      className="w-full pl-11 pr-4 py-3.5 bg-zinc-50 border border-zinc-200 rounded-xl text-sm font-medium text-zinc-950 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:border-transparent transition-all"
                      style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                      autoFocus
                    />
                  </div>
                  <p className="text-[10px] font-medium text-zinc-400 ml-1">Include country code · e.g. +1, +55, +44</p>
                </div>
                <button
                  onClick={handleSendOTP}
                  disabled={loading || !phone.trim()}
                  className="w-full py-4 rounded-xl text-sm font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                  style={btnStyle}
                >
                  {loading ? 'Sending...' : <><span>Send Code</span><ArrowRight className="w-4 h-4" /></>}
                </button>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Verification Code</label>
                  <div className="relative">
                    <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      value={token}
                      onChange={e => setToken(e.target.value.replace(/\D/g, ''))}
                      onKeyDown={e => e.key === 'Enter' && handleVerifyOTP()}
                      placeholder="000000"
                      className="w-full pl-11 pr-4 py-3.5 bg-zinc-50 border border-zinc-200 rounded-xl text-sm font-black text-zinc-950 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:border-transparent transition-all tracking-[0.3em] text-center"
                      style={{ '--tw-ring-color': primaryColor } as React.CSSProperties}
                      autoFocus
                    />
                  </div>
                  <p className="text-[10px] font-medium text-zinc-400 ml-1">6-digit code sent via SMS</p>
                </div>
                <button
                  onClick={handleVerifyOTP}
                  disabled={loading || token.length < 6}
                  className="w-full py-4 rounded-xl text-sm font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                  style={btnStyle}
                >
                  {loading ? 'Verifying...' : <><span>Verify</span><ArrowRight className="w-4 h-4" /></>}
                </button>
                <button
                  onClick={() => { setStep('phone'); setToken(''); setError(null) }}
                  className="w-full py-2 text-xs font-bold text-zinc-400 hover:text-zinc-600 transition-colors flex items-center justify-center gap-1"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Change phone number
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
