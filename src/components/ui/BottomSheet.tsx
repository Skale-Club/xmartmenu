'use client'

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import ModalPortal from './ModalPortal'

/**
 * Bottom sheet in the iOS style, the one shape every ordering overlay of the
 * public menu uses (cart, checkout, "complete your order"), on phones and on
 * large screens alike.
 *
 * - Rises from the bottom edge over a dimmed page, with large rounded top
 *   corners and a grabber; on wide screens it is centred and capped in width.
 * - `detents="medium-large"`: opens at about 60% of the screen and grows to
 *   nearly full height (a gap stays at the top, as on iOS). Tap or drag the
 *   grabber/header up to grow, down to shrink, and down again to close.
 * - `detents="fit"`: as tall as its content, up to nearly full height; dragging
 *   the grabber/header down closes it.
 * - The sheet follows the finger while dragging and snaps on release (distance
 *   or a quick flick). Escape and a tap on the dimmed page close it. Focus,
 *   Escape and the page's scroll lock come from ModalPortal.
 *
 * Elements marked `data-sheet-grip` (the header) also drag the sheet; buttons
 * inside them keep working as buttons.
 */
export default function BottomSheet({
  open,
  onClose,
  detents = 'fit',
  ariaLabel,
  ariaLabelledBy,
  widthClassName = 'sm:max-w-[560px]',
  frameStyle,
  zIndexClassName = 'z-[60]',
  className = '',
  expandLabel = 'Expand',
  shrinkLabel = 'Shrink',
  children,
}: {
  open: boolean
  onClose: () => void
  detents?: 'fit' | 'medium-large'
  ariaLabel?: string
  ariaLabelledBy?: string
  /** Max width on wider screens; the sheet is full width on phones. */
  widthClassName?: string
  /** Where the sheet lives: the whole window by default, or the part a phone keyboard leaves visible. */
  frameStyle?: CSSProperties
  zIndexClassName?: string
  className?: string
  expandLabel?: string
  shrinkLabel?: string
  children: ReactNode
}) {
  // mounted: in the DOM. shown: slid up (false while entering and leaving, for the slide).
  const [mounted, setMounted] = useState(open)
  const [shown, setShown] = useState(false)
  const [large, setLarge] = useState(false)
  const [dragY, setDragY] = useState(0)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ startY: number; lastY: number; lastT: number; velocity: number; moved: boolean; grabber: boolean } | null>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  // Open: mount, then slide up on the next frame. Closed from outside: slide down, then unmount.
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) setMounted(true)
    else setShown(false)
  }
  useEffect(() => {
    if (open) {
      let raf2 = 0
      const raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => setShown(true)) })
      return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2) }
    }
    const t = setTimeout(() => { setMounted(false); setLarge(false); setDragY(0) }, 320)
    return () => clearTimeout(t)
  }, [open])

  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])
  // Closing from inside (backdrop, Escape, drag): slide down first, then tell the owner.
  function requestClose() {
    if (closeTimer.current) return
    setShown(false)
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null
      setLarge(false)
      setDragY(0)
      onCloseRef.current()
    }, 280)
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    if (!target.closest('[data-sheet-grip]')) return
    if (target.closest('button, a, input, textarea, select') && !target.closest('[data-sheet-grabber]')) return
    drag.current = { startY: e.clientY, lastY: e.clientY, lastT: e.timeStamp, velocity: 0, moved: false, grabber: !!target.closest('[data-sheet-grabber]') }
    // Keep the moves and the release even when the finger or mouse leaves the sheet (dragging up past its top).
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d) return
    const dy = e.clientY - d.startY
    if (!d.moved && Math.abs(dy) < 6) return
    if (!d.moved) {
      d.moved = true
      setDragging(true)
    }
    const dt = Math.max(1, e.timeStamp - d.lastT)
    d.velocity = (e.clientY - d.lastY) / dt
    d.lastY = e.clientY
    d.lastT = e.timeStamp
    // Down follows the finger; up resists (rubber band), as the sheet cannot leave the screen.
    setDragY(dy > 0 ? dy : dy / 4)
  }
  function onPointerUp() {
    const d = drag.current
    drag.current = null
    if (!d) return
    // A tap on the grabber (pointer capture keeps its click from reaching the button) toggles the height.
    if (!d.moved) {
      if (d.grabber && detents === 'medium-large') setLarge(v => !v)
      return
    }
    setDragging(false)
    const dy = d.lastY - d.startY
    const flickDown = d.velocity > 0.5
    const flickUp = d.velocity < -0.5
    setDragY(0)
    if (dy > 90 || flickDown) {
      if (detents === 'medium-large' && large) setLarge(false)
      else requestClose()
    } else if ((dy < -40 || flickUp) && detents === 'medium-large') {
      setLarge(true)
    }
  }

  if (!mounted) return null

  const height = detents === 'medium-large'
    ? (large ? 'h-[calc(100%-max(0.75rem,env(safe-area-inset-top)))]' : 'h-[62%]')
    : 'max-h-[calc(100%-max(0.75rem,env(safe-area-inset-top)))]'
  const transition = dragging ? 'none' : 'transform 420ms cubic-bezier(0.32,0.72,0,1), height 420ms cubic-bezier(0.32,0.72,0,1)'

  return (
    <ModalPortal onClose={requestClose}>
      <div className={`menu-root fixed inset-0 ${zIndexClassName}`}>
        <div
          aria-hidden="true"
          onClick={requestClose}
          className={`absolute inset-0 bg-zinc-950/40 transition-opacity duration-300 motion-reduce:transition-none ${shown ? 'opacity-100' : 'opacity-0'}`}
        />
        <div className="pointer-events-none fixed inset-x-0 flex flex-col items-center justify-end" style={frameStyle ?? { top: 0, bottom: 0 }}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            style={{ transform: shown ? `translateY(${dragY}px)` : 'translateY(100%)', transition }}
            className={`pointer-events-auto relative flex w-full flex-col overflow-hidden rounded-t-[28px] bg-menu shadow-[0_-8px_40px_rgb(0_0_0/0.18)] motion-reduce:!transition-none ${widthClassName} ${height} ${className}`}
          >
            <div data-sheet-grip className="flex shrink-0 touch-none justify-center bg-white pt-1.5 pb-0.5">
              {detents === 'medium-large' ? (
                <button
                  type="button"
                  data-sheet-grabber
                  // Keyboard only (detail 0); taps are handled on pointer up.
                  onClick={e => { if (e.detail === 0) setLarge(v => !v) }}
                  aria-label={large ? shrinkLabel : expandLabel}
                  className="flex h-5 w-16 items-center justify-center"
                >
                  <span className="h-[5px] w-9 rounded-full bg-zinc-300" />
                </button>
              ) : (
                <span aria-hidden="true" className="flex h-5 w-16 items-center justify-center">
                  <span className="h-[5px] w-9 rounded-full bg-zinc-300" />
                </span>
              )}
            </div>
            {children}
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
