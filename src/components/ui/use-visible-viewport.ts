'use client'

import { useEffect, useState } from 'react'

export interface VisibleViewport {
  /** Distance from the top of the layout viewport to the visible area (iOS scrolls the page under the keyboard). */
  top: number
  /** Height left visible: the window minus the on-screen keyboard. */
  height: number
}

function read(): VisibleViewport {
  if (typeof window === 'undefined') return { top: 0, height: 0 }
  const view = window.visualViewport
  return view ? { top: view.offsetTop, height: view.height } : { top: 0, height: window.innerHeight }
}

/**
 * The part of the screen the guest can actually see. When the phone keyboard
 * opens, `position: fixed; inset: 0` still spans the whole window and a
 * centred dialog ends up behind the keys; placing the dialog in this box keeps
 * it, and the field being typed in, above the keyboard.
 */
export function useVisibleViewport(): VisibleViewport {
  const [viewport, setViewport] = useState<VisibleViewport>(read)
  useEffect(() => {
    const view = window.visualViewport
    const update = () => setViewport(read())
    update()
    view?.addEventListener('resize', update)
    view?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      view?.removeEventListener('resize', update)
      view?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])
  return viewport
}
