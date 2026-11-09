'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Image from 'next/image'
import { UserRound, X } from 'lucide-react'
import ModalPortal from '@/components/ui/ModalPortal'
import { readLoginAuthority, type LoginAuthority } from '@/lib/auth/browser-login-authority'
import { useVisibleViewport } from '@/components/ui/use-visible-viewport'
import type { MenuCopy } from './menu-i18n'
import type { PhoneContext } from './showcase'

const LoginModal = dynamic(() => import('./LoginModal'), { ssr: false })

/** Paths that are still part of signing in; leaving them means the guest is signed in. */
const SIGN_IN_PATHS = ['/auth/', '/identity']
const isSignInPath = (path: string) => SIGN_IN_PATHS.some(prefix => path.startsWith(prefix))

/**
 * The guest's account entry on the menu: an icon beside the search button
 * (no text, so the bar stays quiet; the name is in aria-label/title).
 *
 * Signed out it opens the sign-in as a popup over the menu, so the guest never
 * leaves it: with the platform's own sign-in that is the customer login page
 * (/auth/login?flow=customer) in a same-origin frame, shown compact; with the
 * legacy sign-in it is the phone-code modal. When the frame moves on from the
 * sign-in pages the popup closes and the icon shows the signed-in dot.
 * Signed in it goes to the guest's panel (/<slug>/me).
 */
export function GuestAccountButton({ slug, primaryColor, copy, locale, phoneContext, bannerUrl, logoUrl, restaurantName }: {
  slug: string
  primaryColor: string
  /** The menu's texts in the guest's language (labels and the sign-in popup). */
  copy: MenuCopy
  /** BCP 47 locale of the menu (country names in the phone picker). */
  locale: string
  /** The restaurant's country/currency, for the phone field. */
  phoneContext?: PhoneContext | null
  /** The restaurant's banner, logo and name, at the top of the sign-in popup. */
  bannerUrl?: string | null
  logoUrl?: string | null
  restaurantName: string
}) {
  const [signedIn, setSignedIn] = useState(false)
  const [open, setOpen] = useState(false)
  const [authority, setAuthority] = useState<LoginAuthority | 'unavailable' | null>(null)

  useEffect(() => {
    let active = true
    fetch('/api/identity/session', { credentials: 'same-origin', cache: 'no-store' })
      .then(response => { if (active && response.ok) setSignedIn(true) })
      .catch(() => {})
    return () => { active = false }
  }, [])

  const activate = () => {
    if (signedIn) { window.location.assign(new URL(`/${slug}/me`, window.location.origin).href); return }
    setOpen(true)
    if (authority) return
    void readLoginAuthority().then(setAuthority).catch(() => setAuthority('unavailable'))
  }
  const done = () => { setOpen(false); setSignedIn(true) }
  const label = signedIn ? copy.myAccount : copy.signIn

  return (
    <>
      <button
        type="button"
        onClick={activate}
        aria-label={label}
        title={label}
        data-testid="menu-account"
        className="relative flex size-11 shrink-0 items-center justify-center rounded-full text-zinc-700 transition-colors hover:bg-zinc-200/60"
      >
        <UserRound className="size-5" />
        {signedIn && (
          <span aria-hidden="true" className="absolute right-2.5 top-2.5 size-2 rounded-full ring-2 ring-menu" style={{ backgroundColor: primaryColor }} />
        )}
      </button>
      {open && authority === 'legacy' && (
        <LoginModal open onClose={() => setOpen(false)} slug={slug} primaryColor={primaryColor} onSuccess={done} logoUrl={logoUrl} restaurantName={restaurantName} copy={copy} phoneContext={phoneContext} locale={locale} bannerUrl={bannerUrl} />
      )}
      {open && authority !== 'legacy' && (
        <SignInFramePopup
          src={authority === 'owned' ? `/auth/login?flow=customer&embed=1&from=${encodeURIComponent(`/${slug}/me`)}` : null}
          unavailable={authority === 'unavailable'}
          title={copy.signIn}
          closeLabel={copy.close}
          logoUrl={logoUrl}
          restaurantName={restaurantName}
          onClose={() => setOpen(false)}
          onSignedIn={done}
        />
      )}
    </>
  )
}

/** The platform sign-in in a same-origin frame, sized to its content, over a dimmed menu. */
function SignInFramePopup({ src, unavailable, title, closeLabel, logoUrl, restaurantName, onClose, onSignedIn }: {
  /** Null while the sign-in mode is still being read. */
  src: string | null
  unavailable: boolean
  title: string
  closeLabel: string
  logoUrl?: string | null
  restaurantName: string
  onClose: () => void
  onSignedIn: () => void
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  // Placed in what the phone keyboard leaves visible, like the phone-code popup.
  const view = useVisibleViewport()
  const [height, setHeight] = useState(440)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // The sign-in ends with a navigation inside the frame (to the guest's panel):
  // as soon as the frame is off the sign-in pages, stop it and close.
  useEffect(() => {
    if (!src) return
    let finished = false
    const check = () => {
      const frame = frameRef.current
      if (finished || !frame) return
      let path: string
      try { path = frame.contentWindow?.location.pathname ?? '' } catch { return }
      if (path && path !== 'blank' && !isSignInPath(path)) {
        finished = true
        frame.src = 'about:blank'
        onSignedIn()
      }
    }
    const timer = window.setInterval(check, 200)
    return () => window.clearInterval(timer)
  }, [src, onSignedIn])

  const onLoad = () => {
    const frame = frameRef.current
    const doc = (() => { try { return frame?.contentDocument ?? null } catch { return null } })()
    if (!frame || !doc?.body) return
    setReady(true)
    const measure = () => setHeight(Math.ceil(doc.documentElement.scrollHeight))
    measure()
    new ResizeObserver(measure).observe(doc.body)
  }

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
          aria-label={title}
          className="relative max-h-full w-full max-w-[400px] overflow-y-auto overscroll-contain rounded-2xl bg-zinc-950 shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
          onClick={e => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="absolute right-3 top-3 z-10 flex size-10 items-center justify-center rounded-full bg-white/15 text-white transition-colors hover:bg-white/25"
          >
            <X className="size-4" />
          </button>
          {/* The restaurant on top, so the guest knows whose account this is. */}
          <div className="flex items-center gap-3 border-b border-white/10 px-6 pb-4 pt-6 pr-14">
            {logoUrl && (
              <div className="relative size-11 shrink-0 overflow-hidden rounded-xl bg-white">
                <Image src={logoUrl} alt="" fill sizes="44px" className="object-contain p-1" />
              </div>
            )}
            <p className="min-w-0 truncate text-[15px] font-semibold text-white">{restaurantName}</p>
          </div>
          {unavailable ? (
            <p className="px-6 py-10 text-center text-sm leading-6 text-zinc-300">Sign-in is temporarily unavailable. Please try again later.</p>
          ) : (
            <>
              {!ready && (
                <div className="flex h-[440px] items-center justify-center" aria-hidden="true">
                  <span className="size-6 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                </div>
              )}
              {src && (
                <iframe
                  ref={frameRef}
                  src={src}
                  title={title}
                  onLoad={onLoad}
                  className={ready ? 'block w-full border-0' : 'absolute h-0 w-full opacity-0'}
                  style={ready ? { height } : undefined}
                />
              )}
            </>
          )}
        </div>
        </div>
      </div>
    </ModalPortal>
  )
}
