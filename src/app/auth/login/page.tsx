'use client'

export const dynamic = 'force-dynamic'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [googleLoading, setGoogleLoading] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [emailLoading, setEmailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

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

  async function handleEmailLogin(e: React.FormEvent) {
    e.preventDefault()
    setEmailLoading(true)
    setError(null)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError('Incorrect email or password.')
      setEmailLoading(false)
      return
    }

    const from = new URLSearchParams(window.location.search).get('from') ?? '/'
    const response = await fetch('/api/auth/resolve-redirect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ next: from }),
    })

    if (!response.ok) {
      setError('Unable to finish login right now. Please try again.')
      setEmailLoading(false)
      return
    }

    const payload = await response.json() as { redirectTo?: string }
    router.replace(payload.redirectTo ?? '/dashboard')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-8">
          {/* Marca */}
          <div className="mb-7 text-center">
            <div className="w-12 h-12 rounded-xl bg-zinc-900 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 13a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1H4a1 1 0 01-1-1v-3zM13 4a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1V4zM13 13a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-3z" />
              </svg>
            </div>
            <a href="/" className="text-xl font-bold text-zinc-900 hover:text-zinc-600 transition-colors">XmartMenu</a>
            <p className="text-sm text-zinc-500 mt-1">Sign in to your menu dashboard</p>
          </div>

          {/* Google */}
          <button
            onClick={handleGoogleLogin}
            disabled={googleLoading || emailLoading}
            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 border border-zinc-300 rounded-xl text-sm font-medium text-zinc-700 bg-white hover:bg-zinc-50 disabled:opacity-50 transition-colors shadow-sm"
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
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-zinc-200" />
            <span className="text-xs text-zinc-400">or sign in with email</span>
            <div className="flex-1 h-px bg-zinc-200" />
          </div>

          {/* Formulário e-mail/senha */}
          <form onSubmit={handleEmailLogin} className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="seu@email.com"
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={emailLoading || googleLoading}
              className="w-full bg-zinc-900 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-zinc-800 disabled:opacity-50 transition-colors"
            >
              {emailLoading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <p className="text-xs text-zinc-400 text-center mt-6">
            By signing in, you agree to the platform terms of use.
          </p>
          <p className="text-xs text-zinc-400 text-center mt-2">
            Don&apos;t have an account?{' '}
            <a href="/auth/register" className="text-zinc-700 underline hover:text-zinc-900">Create one</a>
          </p>
        </div>

        <p className="text-xs text-zinc-400 text-center mt-4">
          <a href="/" className="hover:text-zinc-600 transition-colors">XmartMenu</a> © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  )
}
