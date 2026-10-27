'use client'

import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Renders an overlay straight into <body>, so no ancestor can throw it off
 * centre: a parent with a transform, filter or animation (framer-motion,
 * backdrop-blur…) becomes the containing block of `position: fixed` children
 * and would otherwise pin the overlay to itself instead of the viewport.
 *
 * Also: Escape closes only the topmost overlay (a confirm dialog over a form
 * closes alone), and the page behind stops scrolling while any overlay is
 * open (reference-counted, so stacked overlays don't fight over it).
 *
 * Focus (EX-11): opening moves focus into the overlay (an [autofocus] element,
 * else the first focusable one, else the dialog itself), Tab and Shift+Tab
 * cycle inside the topmost overlay instead of wandering into the page behind
 * it, and closing returns focus to whatever opened it.
 */

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0)
}

const escapeStack: string[] = []
let scrollLocks = 0
let overflowBeforeLock = ''

export function lockBodyScroll(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (scrollLocks === 0) {
    overflowBeforeLock = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  scrollLocks++
  let released = false
  return () => {
    if (released) return
    released = true
    scrollLocks--
    if (scrollLocks === 0) document.body.style.overflow = overflowBeforeLock
  }
}

const subscribeNothing = () => () => {}

export default function ModalPortal({
  children,
  onClose,
  closeOnEscape = true,
  lockScroll = true,
}: {
  children: ReactNode
  onClose?: () => void
  closeOnEscape?: boolean
  lockScroll?: boolean
}) {
  const id = useId()
  const isClient = useSyncExternalStore(subscribeNothing, () => true, () => false)
  const containerRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const closeOnEscapeRef = useRef(closeOnEscape)
  useEffect(() => {
    onCloseRef.current = onClose
    closeOnEscapeRef.current = closeOnEscape
  })

  useEffect(() => {
    escapeStack.push(id)
    const onKey = (e: KeyboardEvent) => {
      if (escapeStack[escapeStack.length - 1] !== id) return
      if (e.key === 'Tab') {
        const root = containerRef.current
        if (!root) return
        const items = focusables(root)
        if (items.length === 0) {
          e.preventDefault()
          return
        }
        const first = items[0]
        const last = items[items.length - 1]
        const active = document.activeElement
        if (e.shiftKey && (active === first || !root.contains(active))) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && (active === last || !root.contains(active))) {
          e.preventDefault()
          first.focus()
        }
        return
      }
      if (e.key !== 'Escape') return
      if (closeOnEscapeRef.current && onCloseRef.current) {
        e.stopPropagation()
        onCloseRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      const i = escapeStack.lastIndexOf(id)
      if (i !== -1) escapeStack.splice(i, 1)
    }
  }, [id])

  useEffect(() => (lockScroll ? lockBodyScroll() : undefined), [lockScroll])

  // Move focus in on open, give it back on close.
  useEffect(() => {
    if (!isClient) return
    const opener = document.activeElement as HTMLElement | null
    const root = containerRef.current
    if (root && !root.contains(document.activeElement)) {
      const target = root.querySelector<HTMLElement>('[autofocus]')
        ?? focusables(root)[0]
        ?? root.querySelector<HTMLElement>('[role="dialog"]')
      if (target && !target.hasAttribute('tabindex') && target.getAttribute('role') === 'dialog') target.setAttribute('tabindex', '-1')
      target?.focus({ preventScroll: true })
    }
    return () => {
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true })
    }
  }, [isClient])

  if (!isClient) return null
  // display: contents keeps the overlay's own layout; the wrapper only scopes focus.
  return createPortal(<div ref={containerRef} style={{ display: 'contents' }}>{children}</div>, document.body)
}
