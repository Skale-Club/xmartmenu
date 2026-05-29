'use client'

export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { captureSecurityEvent } from '@/lib/observability'
import { ArrowRight, ChevronLeft } from 'lucide-react'

export default function LoginPage() {
  const [step, setStep] = useState<'email' | 'password'>('email')
  const [googleLoading, setGoogleLoading] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [emailLoading, setEmailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [logoUrl, setLogoUrl] = useState('/icon.png')
  const router = useRouter()

  useEffect(() => {
    const url = (window as any).__LOGO_URL__
    if (url) setLogoUrl(url)
  }, [])

  async function handleGoogleLogin() {
    setGoogleLoading(true)
    setError(null)
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

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      captureSecurityEvent('Failed admin login', { email })
      setError('Incorrect email or password.')
      setEmailLoading(false)
      return
    }

    const from = new URLSearchParams(window.location.search).get('from') ?? '/'
    let redirectTo = '/dashboard'
    try {
      const response = await fetch('/api/auth/resolve-redirect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ next: from }),
      })
      if (response.ok) {
        const payload = await response.json() as { redirectTo?: string }
        if (payload.redirectTo) redirectTo = payload.redirectTo
      }
    } catch {
      // Fall back to /dashboard | middleware will enforce password change / role routing.
    }
    router.replace(redirectTo)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 px-4 selection:bg-primary/30 relative overflow-hidden">
      {/* Background Glows */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[120px] opacity-40 pointer-events-none" />

      <div className="w-full max-w-sm relative z-10">
        <div className="bg-zinc-900/50 backdrop-blur-xl border border-white/10 rounded-[1.25rem] p-8">
          {/* Marca */}
          <div className="mb-8 text-center">
            <img src={logoUrl} alt="Logo" className="w-12 h-12 mx-auto mb-5" />
            <a href="/" className="text-2xl font-black text-white hover:text-primary transition-colors tracking-tight">XmartMenu</a>
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

              {/* Divisor */}
              <div className="flex items-center gap-3 my-8">
                <div className="flex-1 h-px bg-white/5" />
                <span className="text-[10px] text-zinc-600 font-black uppercase tracking-[0.2em]">or sign in with email</span>
                <div className="flex-1 h-px bg-white/5" />
              </div>

              {/* Step 1: Email */}
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
                  className="w-full bg-primary text-primary-foreground py-4 rounded-full text-base font-black hover:bg-white transition-all hover:scale-[1.02] active:scale-95 mt-4 flex items-center justify-center gap-2"
                >
                  Continue
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
            </>
          ) : (
            <>
              {/* Step 2: Password */}
              <div className="mb-6">
                <button
                  onClick={() => { setStep('email'); setError(null) }}
                  className="flex items-center gap-1 text-xs font-bold text-zinc-500 hover:text-zinc-300 transition-colors mb-4"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Back
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
                  className="w-full bg-primary text-primary-foreground py-4 rounded-full text-base font-black hover:bg-white transition-all hover:scale-[1.02] active:scale-95 mt-4 flex items-center justify-center gap-2"
                >
                  {emailLoading ? 'Signing in...' : (
                    <>
                      Sign in
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>
            </>
          )}

          <p className="text-[10px] font-medium text-zinc-600 text-center mt-8 px-4 leading-relaxed">
            By signing in, you agree to the platform terms of use and privacy policy.
          </p>
          <div className="mt-8 pt-8 border-t border-white/5 text-center">
            <p className="text-sm text-zinc-500 font-medium">
              Don&apos;t have an account?{' '}
              <a href="/auth/register" className="text-white font-black hover:text-primary transition-colors underline underline-offset-4 decoration-white/20 hover:decoration-primary/50">
                Create one
              </a>
            </p>
          </div>
        </div>

        <p className="text-[10px] font-bold text-zinc-700 text-center mt-8 uppercase tracking-[0.2em]">
          <a href="/" className="hover:text-zinc-500 transition-colors">XmartMenu</a> © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  )
}
