import Image from 'next/image'
import type { CSSProperties } from 'react'

/** One responsive image fills its authored scene immediately, without load-time reframing. */
export default function DishPhoto({ src, alt, sizes, priority = false, tone = 'light', fit = 'cover', portrait = false, className = '', style }: {
  src: string
  alt: string
  sizes: string
  priority?: boolean
  tone?: 'light' | 'dark'
  fit?: 'cover' | 'feed'
  /** Apply the shared caption-safe crop only to an explicit authored feed source. */
  portrait?: boolean
  className?: string
  style?: CSSProperties
}) {
  return (
    <div data-dish-photo data-photo-presentation={fit === 'feed' ? 'full-bleed' : 'cover'} className={`absolute inset-0 overflow-hidden ${tone === 'dark' ? 'bg-zinc-950' : 'bg-zinc-100'} ${className}`} style={style}>
      <Image src={src} alt={alt} sizes={sizes} fill draggable={false} priority={priority} className={`object-cover ${fit === 'feed' && portrait ? 'object-[center_65%]' : 'object-center'}`} />
    </div>
  )
}
