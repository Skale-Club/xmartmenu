'use client'

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/** Pixels per second the row drifts on its own: slow enough to read the names. */
const SPEED = 28
/** How long the row waits after a guest touches it before drifting again. */
const RESUME_AFTER_MS = 2500

/**
 * An endless row: the dishes repeat forever in both directions, drift slowly
 * on their own and fade into nothing at both edges.
 *
 * The items are rendered as several identical copies and the row starts on
 * the second one, so there is always another copy to the left and to the
 * right. Whenever the position leaves the middle copy it moves by exactly one
 * copy's width, which looks the same, so neither the drift nor a guest's
 * swipe or mouse drag ever reaches an end. There are always enough copies to
 * fill the widest screen, even when only two or three dishes are featured.
 *
 * Any touch, drag, wheel, hover or Tab focus pauses the drift; it resumes from
 * wherever the guest left it. With "reduce motion" on the row stays endless
 * but only moves when the guest moves it.
 */
export default function FeaturedCarousel({ items, className = '' }: {
  /** One node per item; `clone` is true for the repeated copies (keep them out of the tab order). */
  items: (clone: boolean) => ReactNode[]
  /** Classes for the inner row (padding). */
  className?: string
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const rowRef = useRef<HTMLDivElement | null>(null)
  const [copies, setCopies] = useState(3)

  /** One copy's width including the gap that follows it: the distance the loop jumps. */
  const copyWidth = () => {
    const row = rowRef.current
    const first = row?.firstElementChild as HTMLElement | null
    if (!row || !first) return 0
    return first.offsetWidth + (parseFloat(getComputedStyle(row).columnGap) || 0)
  }

  // Enough copies that one copy of slack on each side always covers the screen.
  useEffect(() => {
    const scroller = scrollerRef.current
    const row = rowRef.current
    if (!scroller || !row) return
    const update = () => {
      const width = copyWidth()
      if (width > 0) setCopies(Math.max(3, Math.ceil(scroller.clientWidth / width) + 2))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(scroller)
    observer.observe(row.firstElementChild as Element)
    return () => observer.disconnect()
  }, [])

  // Start on the second copy, so the row already continues to the left.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    const width = copyWidth()
    if (scroller && width > 0 && scroller.scrollLeft < width / 2) scroller.scrollLeft = width
  }, [copies])

  // Mouse drag: touch already scrolls natively; a mouse grabs and throws the row
  // too, and a drag never counts as a click on the dish under the pointer.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    let pointerId: number | null = null
    let lastX = 0
    let dragged = false
    let travelled = 0

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return
      pointerId = e.pointerId
      lastX = e.clientX
      travelled = 0
      dragged = false
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return
      const dx = e.clientX - lastX
      lastX = e.clientX
      travelled += Math.abs(dx)
      if (!dragged && travelled > 5) {
        dragged = true
        scroller.setPointerCapture(e.pointerId)
        scroller.dataset.dragging = 'true'
      }
      // Relative steps, so the loop can jump a copy mid-drag without a jolt.
      if (dragged) scroller.scrollLeft -= dx
    }
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return
      pointerId = null
      if (scroller.hasPointerCapture(e.pointerId)) scroller.releasePointerCapture(e.pointerId)
      delete scroller.dataset.dragging
    }
    const onClick = (e: MouseEvent) => {
      if (!dragged) return
      dragged = false
      e.preventDefault()
      e.stopPropagation()
    }
    const onDragStart = (e: DragEvent) => e.preventDefault()
    scroller.addEventListener('pointerdown', onDown)
    scroller.addEventListener('pointermove', onMove)
    scroller.addEventListener('pointerup', onUp)
    scroller.addEventListener('pointercancel', onUp)
    scroller.addEventListener('click', onClick, true)
    scroller.addEventListener('dragstart', onDragStart)
    return () => {
      scroller.removeEventListener('pointerdown', onDown)
      scroller.removeEventListener('pointermove', onMove)
      scroller.removeEventListener('pointerup', onUp)
      scroller.removeEventListener('pointercancel', onUp)
      scroller.removeEventListener('click', onClick, true)
      scroller.removeEventListener('dragstart', onDragStart)
    }
  }, [])

  // The drift, and the jump that keeps the position on the middle copy.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')

    let frame = 0
    let last = 0
    // scrollLeft is rounded by some browsers; keep the exact position here.
    let position = scroller.scrollLeft
    let pausedUntil = 0
    let hovering = false
    let holding = false
    let focused = false
    let tabbedAt = 0
    const pause = () => { pausedUntil = performance.now() + RESUME_AFTER_MS }

    const tick = (now: number) => {
      const dt = last ? Math.min(now - last, 64) : 0
      last = now
      const width = copyWidth()
      if (width > 0) {
        const still = hovering || holding || focused || now < pausedUntil || document.hidden || reduce.matches
        if (still) {
          position = scroller.scrollLeft
        } else {
          position += (SPEED * dt) / 1000
          scroller.scrollLeft = position
        }
        // Left the middle copy (drift, swipe, wheel or drag): move by one copy.
        if (scroller.scrollLeft >= width * 1.5) {
          position = scroller.scrollLeft - width
          scroller.scrollLeft = position
        } else if (scroller.scrollLeft < width * 0.5) {
          position = scroller.scrollLeft + width
          scroller.scrollLeft = position
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    const onEnter = () => { hovering = true }
    const onLeave = () => { hovering = false; pause() }
    const onDown = () => { holding = true }
    const onUp = () => { if (holding) { holding = false; pause() } }
    // Tabbing into the row holds it still; the focus a closed dish sheet hands
    // back to the card it came from does not.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Tab') tabbedAt = performance.now() }
    const onFocusIn = () => { if (performance.now() - tabbedAt < 500) focused = true }
    const onFocusOut = () => { if (focused) { focused = false; pause() } }

    scroller.addEventListener('pointerenter', onEnter)
    scroller.addEventListener('pointerleave', onLeave)
    scroller.addEventListener('pointerdown', onDown)
    scroller.addEventListener('touchstart', onDown, { passive: true })
    scroller.addEventListener('wheel', pause, { passive: true })
    scroller.addEventListener('focusin', onFocusIn)
    scroller.addEventListener('focusout', onFocusOut)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('touchend', onUp)
    window.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(frame)
      scroller.removeEventListener('pointerenter', onEnter)
      scroller.removeEventListener('pointerleave', onLeave)
      scroller.removeEventListener('pointerdown', onDown)
      scroller.removeEventListener('touchstart', onDown)
      scroller.removeEventListener('wheel', pause)
      scroller.removeEventListener('focusin', onFocusIn)
      scroller.removeEventListener('focusout', onFocusOut)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('touchend', onUp)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <div
      ref={scrollerRef}
      className="scrollbar-hide cursor-grab overflow-x-auto overscroll-x-contain select-none data-[dragging=true]:cursor-grabbing [mask-image:linear-gradient(to_right,transparent,#000_40px,#000_calc(100%-40px),transparent)] sm:[mask-image:linear-gradient(to_right,transparent,#000_72px,#000_calc(100%-72px),transparent)]"
    >
      <div ref={rowRef} className={`flex w-max gap-3 sm:gap-4 ${className}`}>
        {Array.from({ length: copies }, (_, copy) => (
          // The second copy is the one on screen first: it is the real one for
          // screen readers, the keyboard and analytics.
          <div key={copy} aria-hidden={copy === 1 ? undefined : true} className="flex shrink-0 gap-3 sm:gap-4">
            {items(copy !== 1)}
          </div>
        ))}
      </div>
    </div>
  )
}
