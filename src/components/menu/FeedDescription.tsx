'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import type { DishDetail } from '@/lib/public-dish-details'
import DishDetails from './DishDetails'

/**
 * A dish's description on the feed: two lines, with "See more" when the text is
 * longer or the dish has ingredient/allergen details. Expanding grows it upwards
 * (the block is pinned to the bottom of the screen), so the title moves up with it.
 */
export default function FeedDescription({ text, details, seeMore, seeLess }: { text: string; details: DishDetail[]; seeMore: string; seeLess: string }) {
  const ref = useRef<HTMLParagraphElement | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [clamped, setClamped] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || expanded) return
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text, expanded])

  return (
    <div className="pointer-events-auto mt-3 max-w-[90%]">
      <div className={expanded ? 'max-h-[34dvh] overflow-y-auto overscroll-contain' : ''}>
        <p ref={ref} className={`text-sm font-medium leading-relaxed text-white/75 drop-shadow ${expanded ? '' : 'line-clamp-2'}`}>{text}</p>
        {expanded ? <DishDetails details={details} tone="dark" /> : null}
      </div>
      {clamped || details.length > 0 || expanded ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(value => !value)}
          className="mt-1 min-h-8 text-[11px] font-black uppercase tracking-widest text-white underline underline-offset-4 drop-shadow"
        >
          {expanded ? seeLess : seeMore}
        </button>
      ) : null}
    </div>
  )
}
