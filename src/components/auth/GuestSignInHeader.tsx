import Image from 'next/image'
import { Phone } from 'lucide-react'
import type { ReactNode } from 'react'

/** Height of the banner strip; the popup centres its close button on it (see LoginModal, GuestSignIn). */
export const GUEST_BANNER_HEIGHT = 80
export const GUEST_BANNER_HEIGHT_COMPACT = 56

/**
 * Top of the guest sign-in card, the same in the legacy phone-code popup and
 * the platform sign-in shown inside the menu: the restaurant's banner photo
 * (always the photo, even if the menu header one day plays a video) with its
 * logo cutting the bottom edge, as in the menu header, then the restaurant's
 * name, the title and one line of explanation.
 */
export default function GuestSignInHeader({ bannerUrl, logoUrl, restaurantName, accent, onAccent, title, subtitle, compact = false }: {
  bannerUrl?: string | null
  logoUrl?: string | null
  restaurantName?: string | null
  /** The restaurant's primary colour (safe hex) and the text colour that reads on it. */
  accent: string
  onAccent: string
  title: string
  /** Hidden when null (compact phone step: the keyboard needs the room). */
  subtitle?: ReactNode
  compact?: boolean
}) {
  return (
    <>
      <div
        className="relative overflow-hidden transition-[height]"
        style={{
          height: compact ? GUEST_BANNER_HEIGHT_COMPACT : GUEST_BANNER_HEIGHT,
          ...(!bannerUrl ? { background: `linear-gradient(135deg, color-mix(in srgb, ${accent} 30%, white), color-mix(in srgb, ${accent} 10%, white))` } : {}),
        }}
      >
        {bannerUrl && (
          <>
            <Image src={bannerUrl} alt="" fill sizes="420px" className="object-cover" />
            <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-transparent to-black/10" />
          </>
        )}
      </div>
      <div className="px-6">
        {logoUrl ? (
          <div className={`relative overflow-hidden rounded-2xl bg-white shadow-[0_2px_8px_rgb(0_0_0/0.12)] ring-1 ring-black/5 ${compact ? '-mt-6 size-12' : '-mt-9 size-[72px]'}`}>
            <Image src={logoUrl} alt="" fill sizes="72px" className="object-contain p-2" />
          </div>
        ) : (
          <div className={`flex items-center justify-center rounded-2xl shadow-[0_2px_8px_rgb(0_0_0/0.12)] ${compact ? '-mt-6 size-12' : '-mt-9 size-[72px]'}`} style={{ backgroundColor: accent, color: onAccent }}>
            <Phone className="size-6" aria-hidden="true" />
          </div>
        )}
        {restaurantName && <p className="mt-3 text-[14px] font-medium text-zinc-500">{restaurantName}</p>}
        <h1 id="identity-title" className={`text-[24px] font-semibold leading-tight tracking-tight text-zinc-950 ${restaurantName ? 'mt-0.5' : 'mt-3'}`}>{title}</h1>
        {subtitle ? (
          // Inline: globals.css gives every <p> `text-wrap: pretty` outside the Tailwind layers.
          <p className="mt-1.5 text-[15px] font-normal leading-relaxed text-zinc-600" style={{ textWrap: 'balance' }}>{subtitle}</p>
        ) : null}
      </div>
    </>
  )
}
