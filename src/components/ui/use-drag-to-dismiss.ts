'use client'

import { useEffect, useRef, type RefObject } from 'react'

const AXIS_LOCK_PX = 8
const DISMISS_FLICK = 0.5 // px per ms, downward
const EASE = 'cubic-bezier(0.32,0.72,0,1)'

/**
 * iOS-style "drag down to close" for a sheet whose body scrolls.
 *
 * A touch that starts while the scroll area is at its top and moves mostly
 * downward drags the sheet: it follows the finger (native scroll is held back)
 * and the backdrop fades with it. On release it closes when pulled past a
 * quarter of its height (at most 140px) or flicked down, else it springs back.
 * Sideways or upward moves are left alone, so carousels and scrolling keep
 * working. Touch only: a mouse keeps the close button, Escape and the backdrop.
 *
 * The element moved is `sheetRef`; touches are read on `gestureRef` (defaults
 * to the sheet). `backdropRef`'s background is faded from `backdropColor`.
 */
export function useDragToDismiss({
  sheetRef,
  gestureRef,
  scrollRef,
  backdropRef,
  backdropColor = 'rgb(9 9 11 / 0.4)',
  onDismiss,
}: {
  sheetRef: RefObject<HTMLElement | null>
  gestureRef?: RefObject<HTMLElement | null>
  scrollRef?: RefObject<HTMLElement | null>
  backdropRef?: RefObject<HTMLElement | null>
  backdropColor?: string
  onDismiss: () => void
}) {
  const onDismissRef = useRef(onDismiss)
  useEffect(() => { onDismissRef.current = onDismiss })

  useEffect(() => {
    const target = gestureRef?.current ?? sheetRef.current
    const sheetEl = sheetRef.current
    if (!target || !sheetEl) return
    const sheet: HTMLElement = sheetEl
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

    let state: 'idle' | 'pending' | 'dragging' | 'ignore' = 'idle'
    let startX = 0, startY = 0, lastY = 0, lastT = 0, velocity = 0, atTop = false, dy = 0
    let leaving = false

    const setBackdrop = (progress: number) => {
      const backdrop = backdropRef?.current
      if (!backdrop) return
      // Fade the dim layer only (opacity would fade the sheet inside it too).
      backdrop.style.backgroundColor = progress <= 0 ? '' : `color-mix(in srgb, ${backdropColor} ${Math.round((1 - progress) * 100)}%, transparent)`
    }
    const settle = (y: string, ms: number) => {
      sheet.style.transition = reduced ? 'none' : `transform ${ms}ms ${EASE}`
      sheet.style.transform = y
    }

    function onStart(e: TouchEvent) {
      if (leaving || e.touches.length !== 1) { state = 'ignore'; return }
      const t = e.touches[0]
      startX = t.clientX; startY = lastY = t.clientY; lastT = e.timeStamp; velocity = 0; dy = 0
      atTop = (scrollRef?.current?.scrollTop ?? 0) <= 0
      state = 'pending'
    }
    function onMove(e: TouchEvent) {
      if (state === 'idle' || state === 'ignore') return
      const t = e.touches[0]
      if (!t) return
      const dx = t.clientX - startX
      dy = t.clientY - startY
      if (state === 'pending') {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_LOCK_PX) return
        if (atTop && dy > 0 && Math.abs(dy) > Math.abs(dx)) {
          state = 'dragging'
          sheet.style.transition = 'none'
          if (backdropRef?.current) backdropRef.current.style.transition = 'none'
        } else {
          state = 'ignore'
          return
        }
      }
      // Dragging: the sheet takes the move, the page and the scroll area do not.
      if (e.cancelable) e.preventDefault()
      const dt = Math.max(1, e.timeStamp - lastT)
      velocity = (t.clientY - lastY) / dt
      lastY = t.clientY
      lastT = e.timeStamp
      const y = Math.max(0, dy)
      sheet.style.transform = `translateY(${y}px)`
      setBackdrop(Math.min(1, y / Math.max(1, sheet.offsetHeight)))
    }
    function onEnd() {
      const wasDragging = state === 'dragging'
      state = 'idle'
      if (!wasDragging) return
      const height = sheet.offsetHeight
      const threshold = Math.min(140, height / 4)
      if (dy > threshold || velocity > DISMISS_FLICK) {
        leaving = true
        settle(`translateY(${height + 24}px)`, 260)
        if (backdropRef?.current) {
          backdropRef.current.style.transition = reduced ? 'none' : 'background-color 260ms ease-out'
        }
        setBackdrop(1)
        window.setTimeout(() => onDismissRef.current(), reduced ? 0 : 240)
      } else {
        settle('translateY(0px)', 320)
        if (backdropRef?.current) backdropRef.current.style.transition = reduced ? 'none' : 'background-color 320ms ease-out'
        setBackdrop(0)
      }
    }

    target.addEventListener('touchstart', onStart, { passive: true })
    target.addEventListener('touchmove', onMove, { passive: false })
    target.addEventListener('touchend', onEnd)
    target.addEventListener('touchcancel', onEnd)
    return () => {
      target.removeEventListener('touchstart', onStart)
      target.removeEventListener('touchmove', onMove)
      target.removeEventListener('touchend', onEnd)
      target.removeEventListener('touchcancel', onEnd)
    }
  }, [sheetRef, gestureRef, scrollRef, backdropRef, backdropColor])
}
