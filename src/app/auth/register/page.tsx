'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ArrowRight, CheckCircle2 } from 'lucide-react'

function RegisterForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const from = searchParams.get('from') ?? '/'
  const isQrFlow = from !== '/' && !from.startsWith('/auth')

  const [googleLoading, setGoogleLoading] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        isQrFlow
          ? { name, phone, redirectTo: from }
          : { name, email, phone, password, redirectTo: from }
      ),
    })

    const data = await res.json()

    if (!res.ok) {
      setError(data.error ?? 'Failed to create account')
      setLoading(false)
      return
    }

    if (isQrFlow) {
      router.replace(data.redirect_to ?? from)
      router.refresh()
      setLoading(false)
      return
    }

    setSuccess(true)
    setLoading(false)
  }

  return (
    <div className="bg-zinc-900/50 backdrop-blur-xl border border-white/10 rounded-[1.25rem] p-8">
      <div className="mb-8 text-center">
        <img src="/icon.png" alt="XmartMenu Logo" className="w-12 h-12 mx-auto mb-5" />
        <a href="/" className="text-2xl font-black text-white hover:text-primary transition-colors tracking-tight">XmartMenu</a>
        <p className="text-sm font-bold text-zinc-500 mt-2">
          {isQrFlow ? 'Enter your details to continue' : 'Create your account'}
        </p>
      </div>

      {success ? (
        <div className="text-center space-y-6 py-4">
          <div className="w-16 h-16 bg-primary/10 border border-primary/20 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-8 h-8 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-black text-white">Account created!</h2>
            <p className="text-sm text-zinc-500 font-medium mt-3 leading-relaxed">
              Check your email to confirm your account. After confirming, you&apos;ll be taken back to the menu.
            </p>
          </div>
          <a
            href={from}
            className="inline-flex w-full items-center justify-center bg-white text-zinc-950 py-4 rounded-full text-base font-black hover:bg-zinc-200 transition-all hover:scale-[1.02] active:scale-95 mt-4"
          >
            Back to menu
          </a>
        </div>
      ) : (
        <>
          {/* Google */}
          {!isQrFlow && (
            <>
              <button
                onClick={handleGoogleLogin}
                disabled={googleLoading || loading}
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

              <div className="flex items-center gap-3 my-8">
                <div className="flex-1 h-px bg-white/5" />
                <span className="text-[10px] text-zinc-600 font-black uppercase tracking-[0.2em]">or sign up with email</span>
                <div className="flex-1 h-px bg-white/5" />
              </div>
            </>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-widest mb-2 ml-1">Full name</label>
              <input
                type="text"
                required
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Your name"
                className="w-full px-5 py-3.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all"
              />
            </div>

            {!isQrFlow && (
              <div>
                <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-widest mb-2 ml-1">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full px-5 py-3.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all"
                />
              </div>
            )}

            <div>
              <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-widest mb-2 ml-1">Phone</label>
              <input
                type="tel"
                required
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="+1 (555) 000-0000"
                className="w-full px-5 py-3.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all"
              />
            </div>

            {!isQrFlow && (
              <div>
                <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-widest mb-2 ml-1">Password</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-5 py-3.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all"
                />
                <p className="text-[10px] text-zinc-600 mt-2 ml-1 font-bold">Minimum 8 characters</p>
              </div>
            )}

            {error && <p className="text-xs text-red-500 font-bold ml-1">{error}</p>}

            <button
              type="submit"
              disabled={loading || googleLoading}
              className="w-full bg-primary text-zinc-950 py-4 rounded-full text-base font-black hover:bg-white transition-all hover:scale-[1.02] active:scale-95 mt-4 flex items-center justify-center gap-2"
            >
              {loading ? 'Creating account...' : (
                <>
                  {isQrFlow ? 'Continue' : 'Create account'}
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            {!isQrFlow && (
              <div className="mt-8 pt-8 border-t border-white/5 text-center">
                <p className="text-sm text-zinc-500 font-medium">
                  Already have an account?{' '}
                  <a href={`/auth/login?from=${from}`} className="text-white font-black hover:text-primary transition-colors underline underline-offset-4 decoration-white/20 hover:decoration-primary/50">
                    Sign in
                  </a>
                </p>
              </div>
            )}
          </form>
        </>
      )}
    </div>
  )
}

export default function RegisterPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 px-4 selection:bg-primary/30 relative overflow-hidden">
      {/* Background Glows */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/5 rounded-full blur-[120px] opacity-40 pointer-events-none" />
      
      <div className="w-full max-w-sm relative z-10 py-12">
        <Suspense fallback={<div className="bg-zinc-900/50 backdrop-blur-xl border border-white/10 rounded-[1.25rem] p-8 h-[500px] animate-pulse" />}>
          <RegisterForm />
        </Suspense>
        <p className="text-[10px] font-bold text-zinc-700 text-center mt-8 uppercase tracking-[0.2em]">
          <a href="/" className="hover:text-zinc-500 transition-colors">XmartMenu</a> © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  )
}
