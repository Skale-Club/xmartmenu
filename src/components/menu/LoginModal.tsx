'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'
import LoginClient from '@/app/(public)/[slug]/me/login/LoginClient'

interface Props {
  open: boolean
  onClose: () => void
  slug: string
  primaryColor: string
  onSuccess: () => void
}

export default function LoginModal({ open, onClose, slug, primaryColor, onSuccess }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full sm:max-w-sm bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 p-1.5 rounded-full bg-zinc-100 hover:bg-zinc-200 transition-colors"
        >
          <X className="w-4 h-4 text-zinc-600" />
        </button>
        <LoginClient
          slug={slug}
          primaryColor={primaryColor}
          onSuccess={onSuccess}
        />
      </div>
    </div>
  )
}
