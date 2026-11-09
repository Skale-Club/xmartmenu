'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'
import LoginClient from '@/app/(public)/[slug]/me/login/LoginClient'
import ModalPortal from '@/components/ui/ModalPortal'
import { useVisibleViewport } from '@/components/ui/use-visible-viewport'
import type { LoginCopy } from './menu-i18n'
import type { PhoneContext } from './showcase'

interface Props {
  open: boolean
  onClose: () => void
  slug: string
  primaryColor: string
  onSuccess: () => void
  logoUrl?: string | null
  restaurantName?: string | null
  copy?: LoginCopy
  phoneContext?: PhoneContext | null
  locale?: string
  bannerUrl?: string | null
}

/**
 * The phone-code sign-in as a card over the menu. It lives in the part of the
 * screen the keyboard leaves visible, so the field being typed in never ends
 * up behind the keys; when that space is short the card scrolls inside it.
 */
export default function LoginModal({ open, onClose, slug, primaryColor, onSuccess, logoUrl, restaurantName, copy, phoneContext, locale, bannerUrl }: Props) {
  const view = useVisibleViewport()
  // Keyboard up: the card's banner shrinks (see LoginClient `compact`).
  const compact = view.height > 0 && view.height < 560

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <ModalPortal closeOnEscape={false}>
      <div className="fixed inset-0 z-50" onClick={onClose}>
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
        <div
          className="absolute inset-x-0 flex items-center justify-center p-4"
          style={view.height ? { top: view.top, height: view.height } : { inset: 0 }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={copy?.loginTitle ?? 'Sign in'}
            className="relative max-h-full w-full max-w-sm overflow-y-auto overscroll-contain rounded-2xl bg-white shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={onClose}
              aria-label={copy?.close ?? 'Close'}
              // Centred on the banner: 80 px tall (56 px compact), the button 40 px.
              style={{ top: compact ? 8 : 20 }}
              className="absolute right-3 z-10 flex size-10 items-center justify-center rounded-full bg-white/95 text-zinc-900 shadow-sm transition-colors hover:bg-white"
            >
              <X className="size-[18px]" />
            </button>
            <LoginClient
              slug={slug}
              primaryColor={primaryColor}
              onSuccess={onSuccess}
              logoUrl={logoUrl}
              restaurantName={restaurantName}
              copy={copy}
              phoneContext={phoneContext}
              locale={locale}
              bannerUrl={bannerUrl}
              compact={compact}
            />
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
