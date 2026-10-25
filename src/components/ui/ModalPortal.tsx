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
 */

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
  const onCloseRef = useRef(onClose)
  const closeOnEscapeRef = useRef(closeOnEscape)
  useEffect(() => {
    onCloseRef.current = onClose
    closeOnEscapeRef.current = closeOnEscape
  })

  useEffect(() => {
    escapeStack.push(id)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || escapeStack[escapeStack.length - 1] !== id) return
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

  if (!isClient) return null
  return createPortal(children, document.body)
}
