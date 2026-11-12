'use client'

import { DeliveryImage } from '@/components/delivery-image'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { captureSecurityEvent } from '@/lib/observability'
import { ArrowRight, ChevronLeft, X } from 'lucide-react'
import ModalPortal from '@/components/ui/ModalPortal'
import SignInFrameDialog from '@/components/auth/SignInFrameDialog'
import GradientTopLine from '@/components/ui/GradientTopLine'
import { readLoginAuthority, requireLoginAuthority, type LoginAuthority } from '@/lib/auth/browser-login-authority'
import { ownedLoginDestination } from '@/lib/auth/browser-owned-login'

interface Props {
  open: boolean
  onClose: () => void
  logoUrl?: string | null
}

export default function AdminLoginModal({ open, onClose, logoUrl }: Props) {
  const [step, setStep] = useState<'email' | 'password'>('email')
  const [googleLoading, setGoogleLoading] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [emailLoading, setEmailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const [authority, setAuthority] = useState<LoginAuthority | 'unavailable' | null>(null)

  useEffect(() => {
    if (!open) return
    let active = true
    setAuthority(null)
    void readLoginAuthority().then(async value => {
      // Already signed in: "Start" goes straight to the panel instead of showing a sign-in card
      // (the dialog keeps its loading state until the page changes).
      if (value === 'owned') {
        const session = await fetch('/api/identity/session', { credentials: 'same-origin', cache: 'no-store' }).catch(() => null)
        if (session?.ok) {
          window.location.assign(new URL(await ownedLoginDestination('/'), window.location.origin).href)
          return
        }
      }
      if (active) setAuthority(value)
    }).catch(() => { if (active) setAuthority('unavailable') })
    return () => { active = false }
  },[open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) {
      setStep('email')
      setEmail('')
      setPassword('')
      setError(null)
    }
  }, [open])

  async function handleGoogleLogin() {
    setGoogleLoading(true)
    setError(null)
    try { await requireLoginAuthority('legacy') }
    catch { setError('Sign-in is unavailable or changed. Reload and try again.'); setGoogleLoading(false); return }
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) {
      setError('Failed to connect with Google. Please try again.')
      setGoogleLoading(false)
    }
  }

  function handleEmailContinue(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setError(null)
    setStep('password')
  }

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault()
    setEmailLoading(true)
    setError(null)
    try { await requireLoginAuthority('legacy') }
    catch { setError('Sign-in is unavailable or changed. Reload and try again.'); setEmailLoading(false); return }

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      captureSecurityEvent('Failed admin login', { email })
      setError('Incorrect email or password.')
      setEmailLoading(false)
      return
    }

    try {
      const response = await fetch('/api/auth/resolve-redirect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ next: '/' }),
      })
      if (!response.ok) throw new Error('Sign-in unavailable')
      const payload = await response.json() as { redirectTo?: string }
      if (!payload.redirectTo?.startsWith('/') || payload.redirectTo.startsWith('//') || payload.redirectTo.includes('\\') || /[\u0000-\u001f\u007f]/.test(payload.redirectTo)) throw new Error('Invalid sign-in destination')
      router.replace(payload.redirectTo)
    } catch {
      setError('Your access could not be confirmed. Reload and try again.')
      setEmailLoading(false)
    }
  }

  if (!open) return null

  // The platform's own sign-in, right here in the popup (as in Xpot): the sign-in page on its dark card in a
  // same-origin frame; when it finishes, this page goes where the sign-in wanted to go (the panel).
  if (authority !== 'legacy') return <SignInFrameDialog
    src={authority === 'owned' ? '/auth/login?embed=1' : null}
    unavailable={authority === 'unavailable'}
    title="Sign in to XmartMenu"
    closeLabel="Close sign in"
    tone="dark"
    // Top corner, as on the site's e-mail sign-in card.
    closeTop={12}
    onClose={onClose}
    onSignedIn={path => window.location.assign(new URL(path, window.location.origin).href)}
  />

  return (
    <ModalPortal closeOnEscape={false}>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Admin sign in"
        className="relative max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto rounded-[1.25rem] border border-white/10 bg-zinc-900/95 p-5 shadow-2xl backdrop-blur-xl sm:p-8"
        onClick={e => e.stopPropagation()}
      >
        <GradientTopLine />
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 flex min-h-11 min-w-11 items-center justify-center rounded-full bg-white/5 hover:bg-white/10 transition-colors sm:right-4 sm:top-4"
        >
          <X className="w-4 h-4 text-zinc-400" />
        </button>

        {/* Logo + title */}
        <div className="mb-8 text-center">
          {logoUrl && (
            <DeliveryImage src={logoUrl} width={48} height={48} sizes="48px" alt="Logo" className="w-12 h-12 mx-auto mb-5" />
          )}
          <p className="text-2xl font-black text-white tracking-tight">XmartMenu</p>
          <p className="text-sm font-bold text-zinc-500 mt-2">Sign in to your menu dashboard</p>
        </div>

        {step === 'email' ? (
          <>
            {/* Google */}
            <button
              onClick={handleGoogleLogin}
              disabled={googleLoading}
              className="w-full flex items-center justify-center gap-3 px-4 py-3.5 border border-white/10 rounded-full text-sm font-bold text-white bg-white/5 hover:bg-white/10 disabled:opacity-50 transition-all hover:scale-[1.02] active:scale-95"
            >
              {googleLoading ? (
                <svg className="w-5 h-5 animate-spin text-zinc-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
              )}
              {googleLoading ? 'Redirecting...' : 'Continue with Google'}
            </button>

            <div className="flex items-center gap-3 my-6">
              <div className="flex-1 h-px bg-white/5" />
              <span className="text-[10px] text-zinc-600 font-black uppercase tracking-[0.2em]">or sign in with email</span>
              <div className="flex-1 h-px bg-white/5" />
            </div>

            <form onSubmit={handleEmailContinue} className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-widest mb-2 ml-1">Email</label>
                <input
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-5 py-3.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all"
                />
              </div>
              {error && <p className="text-xs text-red-500 font-bold ml-1">{error}</p>}
              <button
                type="submit"
                disabled={googleLoading}
                className="w-full bg-primary text-primary-foreground py-4 rounded-full text-base font-black hover:bg-white transition-all hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-2"
              >
                Continue <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          </>
        ) : (
          <>
            <div className="mb-6">
              <button
                onClick={() => { setStep('email'); setError(null) }}
                className="flex items-center gap-1 text-xs font-bold text-zinc-500 hover:text-zinc-300 transition-colors mb-4"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Back
              </button>
              <p className="text-sm text-zinc-400 font-medium truncate">{email}</p>
            </div>

            <form onSubmit={handleEmailLogin} className="space-y-4">
              <div>
                <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-widest mb-2 ml-1">Password</label>
                <input
                  type="password"
                  required
                  autoFocus
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-5 py-3.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all"
                />
              </div>
              {error && <p className="text-xs text-red-500 font-bold ml-1">{error}</p>}
              <button
                type="submit"
                disabled={emailLoading}
                className="w-full bg-primary text-primary-foreground py-4 rounded-full text-base font-black hover:bg-white transition-all hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-2"
              >
                {emailLoading ? 'Signing in...' : <><span>Sign in</span><ArrowRight className="w-4 h-4" /></>}
              </button>
            </form>
          </>
        )}

        <p className="text-[10px] font-medium text-zinc-600 text-center mt-6 px-4 leading-relaxed">
          By signing in, you agree to the platform terms of use and privacy policy.
        </p>
      </div>
    </div>
    </ModalPortal>
  )
}
