'use client'

/**
 * The dish feature pill: ONE component for every surface (feed, cards, dish
 * sheet, admin), so a change here changes it everywhere (owner, 2026-11-12).
 * Shape and type come from the visual feed's pill; the colour adapts to the
 * surface: `glass` over photos (dark glass, the tag's colour as text), `solid`
 * on light surfaces (the tag's own background and text colours).
 * Which feature a dish shows is decided by `dishFeature` in src/lib/menu/dish-tags.ts.
 */
import { tagColor } from '@/lib/menu/dish-tags'
import { translateTag } from './menu-i18n'

export default function DishFeaturePill({ tag, lang, tone = 'solid', className = '' }: {
  tag: string
  lang: string
  tone?: 'glass' | 'solid'
  className?: string
}) {
  const color = tagColor(tag)
  const glass = tone === 'glass'
  return (
    <span
      className={`inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-[9px] font-black uppercase leading-none tracking-wider ${glass ? 'border-white/15 bg-black/25 backdrop-blur' : 'border-transparent'} ${className}`}
      style={glass ? { color: color.background } : { backgroundColor: color.background, color: color.text }}
    >
      {translateTag(tag, lang)}
    </span>
  )
}
