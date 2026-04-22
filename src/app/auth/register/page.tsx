'use client'

import { useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function RegisterForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const from = searchParams.get('from') ?? '/'
  const isQrFlow = from !== '/' && !from.startsWith('/auth')

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

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
    <div className="bg-white rounded-2xl shadow-sm border border-zinc-200 p-8">
      <div className="mb-7 text-center">
        <div className="w-12 h-12 rounded-xl bg-zinc-900 flex items-center justify-center mx-auto mb-4">
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        </div>
        <a href="/" className="text-xl font-bold text-zinc-900 hover:text-zinc-600 transition-colors">XmartMenu</a>
        <p className="text-sm text-zinc-500 mt-1">
          {isQrFlow ? 'Enter your name and phone to continue' : 'Create your account'}
        </p>
      </div>

      {success ? (
        <div className="text-center space-y-4">
          <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-zinc-900">Account created!</h2>
          <p className="text-sm text-zinc-500">
            Check your email to confirm your account. After confirming, you&apos;ll be taken back to the menu.
          </p>
          <a
            href={from}
            className="inline-block w-full bg-zinc-900 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-zinc-800 transition-colors text-center"
          >
            Back to menu
          </a>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">Full name</label>
            <input
              type="text"
              required
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Your name"
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
            />
          </div>

          {!isQrFlow && (
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-1">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-zinc-700 mb-1">Phone</label>
            <input
              type="tel"
              required
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="+1 (555) 000-0000"
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900"
            />
          </div>

          {!isQrFlow && (
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
              <p className="text-xs text-zinc-400 mt-1">Minimum 8 characters</p>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-zinc-900 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-zinc-800 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Creating account...' : isQrFlow ? 'Continue' : 'Create account'}
          </button>

          {!isQrFlow && (
            <p className="text-xs text-zinc-400 text-center">
              Already have an account?{' '}
              <a href={`/auth/login?from=${from}`} className="text-zinc-700 underline hover:text-zinc-900">Sign in</a>
            </p>
          )}
        </form>
      )}
    </div>
  )
}

export default function RegisterPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 px-4">
      <div className="w-full max-w-sm">
        <Suspense fallback={<div className="bg-white rounded-2xl border border-zinc-200 p-8 h-96 animate-pulse" />}>
          <RegisterForm />
        </Suspense>
        <p className="text-xs text-zinc-400 text-center mt-4">
          <a href="/" className="hover:text-zinc-600 transition-colors">XmartMenu</a> © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  )
}
