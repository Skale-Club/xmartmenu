'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import { GUEST_BANNER_HEIGHT } from '@/components/auth/GuestSignInHeader'
import { UserRound } from 'lucide-react'
import SignInFrameDialog from '@/components/auth/SignInFrameDialog'
import { readLoginAuthority, type LoginAuthority } from '@/lib/auth/browser-login-authority'
import type { MenuCopy } from './menu-i18n'
import type { PhoneContext } from './showcase'

const LoginModal = dynamic(() => import('./LoginModal'), { ssr: false })

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
export function GuestAccountButton({ slug, primaryColor, copy, lang, locale, phoneContext, bannerUrl, logoUrl, restaurantName }: {
  slug: string
  primaryColor: string
  /** The menu's texts in the guest's language (labels and the sign-in popup). */
  copy: MenuCopy
  /** Menu language code, passed to the embedded platform sign-in. */
  lang: string
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
        <SignInFrameDialog
          // The sign-in page draws the restaurant's card itself (banner, logo, colour, country, language) from these.
          src={authority === 'owned' ? `/auth/login?flow=customer&embed=1&tenant=${encodeURIComponent(slug)}&lang=${encodeURIComponent(lang)}&from=${encodeURIComponent(`/${slug}/me`)}` : null}
          unavailable={authority === 'unavailable'}
          title={copy.signIn}
          closeLabel={copy.close}
          onClose={() => setOpen(false)}
          onSignedIn={done}
          // Centred on the card's banner (drawn inside the frame); the button is 40 px.
          closeTop={(GUEST_BANNER_HEIGHT - 40) / 2}
        />
      )}
    </>
  )
}
