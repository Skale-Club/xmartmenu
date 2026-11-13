'use client'

/**
 * iOS-style bottom sheet (owner rule for every sheet in the app,
 * docs/product/design-consistency.md "Sheets"): a grabber on top, drag down to
 * close (or fling), drag up to expand to the large size, rubber-band past the
 * top, the scrim fading with the drag. The body scrolls on its own. The
 * release decision is the pure, unit-tested src/lib/sheet-gesture.ts.
 *
 * Menu sheets use src/components/ui/BottomSheet.tsx (portal, scroll lock,
 * detents). This one exists for the AR camera: the WebXR DOM overlay only shows
 * what is inside its own root, so the sheet must render in place (`contained`),
 * not in a portal on <body>.
 *
 * `tone="dark"` is the camera (AR) look; `tone="light"` the menu look.
 * `contained` positions it inside the nearest positioned parent (the AR
 * overlay) instead of the viewport.
 */

import { useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { scrimOpacity, sheetOffset, sheetRelease } from '@/lib/sheet-gesture'

interface DragSheetProps {
  /** Accessible name of the dialog, and of the scrim's close button. */
  label: string
  closeLabel: string
  onClose: () => void
  /** Fixed top part (title); dragging it moves the sheet. */
  header?: ReactNode
  children: ReactNode
  tone?: 'dark' | 'light'
  contained?: boolean
}

const CLOSE_MS = 220

export default function DragSheet({ label, closeLabel, onClose, header, children, tone = 'light', contained = false }: DragSheetProps) {
  const [dy, setDy] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [closing, setClosing] = useState(false)
  const start = useRef<{ y: number; t: number } | null>(null)

  const close = () => {
    if (closing) return
    setClosing(true)
    window.setTimeout(onClose, CLOSE_MS)
  }
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button, a, input')) return
    start.current = { y: event.clientY, t: performance.now() }
    setDragging(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return
    setDy(sheetOffset(event.clientY - start.current.y))
  }
  const up = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return
    const raw = event.clientY - start.current.y
    const ms = performance.now() - start.current.t
    start.current = null
    setDragging(false)
    setDy(0)
    const result = sheetRelease(raw, ms, expanded)
    if (result === 'close') close()
    else if (result === 'collapse') setExpanded(false)
    else if (result === 'expand') setExpanded(true)
  }

  const dark = tone === 'dark'
  const place = contained ? 'absolute' : 'fixed'
  const ease = 'cubic-bezier(.2,.8,.2,1)'
  return <>
    <button
      type="button"
      aria-label={closeLabel}
      onClick={close}
      className={`${place} inset-0 z-[95] cursor-default ${dark ? 'bg-black/30' : 'bg-zinc-950/40'}`}
      style={{ opacity: closing ? 0 : scrimOpacity(dy), transition: dragging ? 'none' : `opacity ${CLOSE_MS}ms ease` }}
    />
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className={`${place} inset-x-0 bottom-0 z-[96] flex flex-col overflow-hidden rounded-t-3xl px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] motion-safe:animate-[sheet-in_280ms_cubic-bezier(.2,.8,.2,1)_backwards] ${dark ? 'bg-[rgb(21_24_25/0.94)] text-white backdrop-blur-xl' : 'bg-white text-zinc-900 shadow-[0_-8px_32px_rgb(0_0_0/0.12)]'}`}
      style={{
        maxHeight: expanded ? 'calc(100% - 56px)' : '64%',
        transform: closing ? 'translateY(100%)' : `translateY(${dy}px)`,
        transition: dragging ? 'none' : `transform 260ms ${ease}, max-height 260ms ${ease}`,
        touchAction: 'none',
      }}
    >
      <div className="shrink-0 cursor-grab pt-2 pb-2 active:cursor-grabbing" style={{ touchAction: 'none' }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <span aria-hidden className={`mx-auto mb-4 block h-[5px] w-9 rounded-full ${dark ? 'bg-white/35' : 'bg-zinc-300'}`} />
        {header}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" style={{ touchAction: 'pan-y' }}>{children}</div>
    </div>
  </>
}
