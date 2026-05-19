'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Lock } from 'lucide-react'

interface Props {
  slug: string
  menuSlug: string
  primaryColor: string
  children: React.ReactNode
}

export default function PrivateMenuWrapper({ slug, menuSlug, primaryColor, children }: Props) {
  const [status, setStatus] = useState<'loading' | 'ok' | 'locked'>('loading')

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      setStatus(user?.phone ? 'ok' : 'locked')
    })
  }, [])

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-zinc-200 rounded-full animate-spin" style={{ borderTopColor: primaryColor }} />
      </div>
    )
  }

  if (status === 'locked') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 px-4">
        <div className="text-center max-w-sm">
          <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-lg" style={{ backgroundColor: primaryColor }}>
            <Lock className="w-10 h-10" style={{ color: '#09090b' }} />
          </div>
          <h1 className="text-2xl font-black text-zinc-950 tracking-tight mb-2">Private Menu</h1>
          <p className="text-sm font-medium text-zinc-500 mb-8">
            This menu is exclusive. Sign in with your phone to access in-store pricing.
          </p>
          <a
            href={`/${slug}/me/login`}
            className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-full text-sm font-black uppercase tracking-widest transition-all active:scale-95 shadow-lg"
            style={{ backgroundColor: primaryColor, color: '#09090b' }}
          >
            Sign In with Phone
          </a>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
