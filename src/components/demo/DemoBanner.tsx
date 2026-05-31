'use client'

import { useEffect, useState } from 'react'
import { Sparkles, X, ArrowRight } from 'lucide-react'

// Renders nothing unless the visitor is in demo mode (xm_demo cookie set by
// /demo). Detecting the cookie client-side keeps the public menu pages static —
// the server layouts can mount <DemoBanner /> unconditionally.
function hasDemoCookie() {
  if (typeof document === 'undefined') return false
  return document.cookie.split('; ').some((c) => c === 'xm_demo=1')
}

export default function DemoBanner() {
  const [show, setShow] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)

  useEffect(() => {
    setShow(hasDemoCookie())
  }, [])

  if (!show) return null

  return (
    <>
      <div className="fixed bottom-4 left-1/2 z-[60] flex w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 items-center gap-3 rounded-full border border-white/10 bg-zinc-900/95 px-4 py-3 text-white shadow-2xl backdrop-blur-xl">
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Sparkles className="h-4 w-4" />
        </span>
        <p className="flex-1 text-sm font-medium leading-snug">
          <span className="font-bold">You&apos;re exploring the XmartMenu demo.</span>{' '}
          <span className="hidden text-zinc-400 sm:inline">
            Create your own digital menu in minutes.
          </span>
        </p>
        <button
          onClick={() => setModalOpen(true)}
          className="flex flex-shrink-0 items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-black text-primary-foreground transition-all hover:scale-[1.03] active:scale-95"
        >
          Sign up free <ArrowRight className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setShow(false)}
          aria-label="Dismiss"
          className="flex-shrink-0 rounded-full p-1.5 text-zinc-400 transition-colors hover:bg-white/10"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <DemoSignupModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  )
}

function DemoSignupModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) {
      setError(null)
      setDone(false)
      setLoading(false)
    }
  }, [open])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, phone, password, redirectTo: '/dashboard' }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong. Please try again.')
        setLoading(false)
        return
      }
      setDone(true)
    } catch {
      setError('Network error. Please try again.')
    }
    setLoading(false)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-sm rounded-[1.25rem] border border-white/10 bg-zinc-900/95 p-8 shadow-2xl backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full bg-white/5 p-1.5 transition-colors hover:bg-white/10"
        >
          <X className="h-4 w-4 text-zinc-400" />
        </button>

        {done ? (
          <div className="py-6 text-center">
            <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Sparkles className="h-6 w-6" />
            </div>
            <p className="text-xl font-black text-white">Check your email</p>
            <p className="mt-2 text-sm font-medium text-zinc-400">
              We sent a confirmation link to <span className="text-zinc-200">{email}</span>. Confirm
              it to finish creating your restaurant account.
            </p>
            <button
              onClick={onClose}
              className="mt-6 w-full rounded-full bg-white/5 py-3 text-sm font-bold text-white transition-colors hover:bg-white/10"
            >
              Back to the demo
            </button>
          </div>
        ) : (
          <>
            <div className="mb-7 text-center">
              <p className="text-2xl font-black tracking-tight text-white">Create your account</p>
              <p className="mt-2 text-sm font-bold text-zinc-500">
                Launch your own menu like this one.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <input
                type="text"
                required
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="w-full rounded-xl border border-white/10 bg-white/5 px-5 py-3.5 text-sm text-white placeholder-zinc-600 transition-all focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-xl border border-white/10 bg-white/5 px-5 py-3.5 text-sm text-white placeholder-zinc-600 transition-all focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Phone number"
                className="w-full rounded-xl border border-white/10 bg-white/5 px-5 py-3.5 text-sm text-white placeholder-zinc-600 transition-all focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password (min. 8 characters)"
                className="w-full rounded-xl border border-white/10 bg-white/5 px-5 py-3.5 text-sm text-white placeholder-zinc-600 transition-all focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              {error && <p className="ml-1 text-xs font-bold text-red-500">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-4 text-base font-black text-primary-foreground transition-all hover:scale-[1.02] hover:bg-white active:scale-95 disabled:opacity-50"
              >
                {loading ? 'Creating...' : (
                  <>
                    <span>Create free account</span>
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </form>

            <p className="mt-6 px-4 text-center text-[10px] font-medium leading-relaxed text-zinc-600">
              By signing up, you agree to the platform terms of use and privacy policy.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
