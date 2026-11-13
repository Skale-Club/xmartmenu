import Image from 'next/image'
import type { CSSProperties } from 'react'

/** One responsive image fills its authored scene immediately, without load-time reframing. */
export default function DishPhoto({ src, alt, sizes, priority = false, tone = 'light', fit = 'cover', className = '', style }: {
  src: string
  alt: string
  sizes: string
  priority?: boolean
  tone?: 'light' | 'dark'
  fit?: 'cover' | 'feed'
  className?: string
  style?: CSSProperties
}) {
  return (
    <div data-dish-photo data-photo-presentation={fit === 'feed' ? 'full-bleed' : 'cover'} className={`absolute inset-0 overflow-hidden ${tone === 'dark' ? 'bg-zinc-950' : 'bg-zinc-100'} ${className}`} style={style}>
      <Image src={src} alt={alt} sizes={sizes} fill draggable={false} priority={priority} className="object-cover object-center" />
    </div>
  )
}
