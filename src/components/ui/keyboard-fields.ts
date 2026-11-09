'use client'

import { useEffect, type CSSProperties, type FocusEvent, type KeyboardEvent } from 'react'
import { useVisibleViewport, type VisibleViewport } from './use-visible-viewport'

/**
 * Phones open the keyboard over the page. Once it is up (about 300 ms), bring
 * the field being typed in to the middle of what is still visible, so it is
 * never left behind the keys or under a pinned footer.
 */
export function keepFieldVisible(e: FocusEvent<HTMLElement>) {
  const field = e.currentTarget
  window.setTimeout(() => {
    if (document.activeElement === field) field.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, 300)
}

const FIELDS = 'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([disabled]):not([readonly]), textarea:not([disabled]):not([readonly]), select:not([disabled])'

/**
 * Enter (the keyboard's "Next") in a field that is not the form's last one
 * moves to the next field instead of submitting; in the last one it submits,
 * so the keyboard's Go/Done finishes the form. Put on each input of a form.
 */
export function nextFieldOnEnter(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
  const form = e.currentTarget.form
  if (!form) return
  const fields = Array.from(form.querySelectorAll<HTMLElement>(FIELDS)).filter(el => el.getClientRects().length > 0)
  const next = fields[fields.indexOf(e.currentTarget) + 1]
  if (!next) return
  e.preventDefault()
  next.focus()
}

const TEXT_FIELD = /^(INPUT|TEXTAREA|SELECT)$/
const NOT_TYPED = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color', 'image', 'hidden'])

/**
 * The same as `keepFieldVisible`, for a whole screen at once (the admin
 * dashboard and its dialogs): whatever field gets focus is brought into view
 * once the keyboard is up. Does nothing on screens without one.
 */
export function useRevealFocusedField() {
  useEffect(() => {
    let timer: number | undefined
    const onFocusIn = (e: Event) => {
      const field = e.target as HTMLElement | null
      if (!field || !TEXT_FIELD.test(field.tagName)) return
      if (field instanceof HTMLInputElement && NOT_TYPED.has(field.type)) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const view = window.visualViewport
        if (document.activeElement !== field || !view || window.innerHeight - view.height < 80) return
        const box = field.getBoundingClientRect()
        // Already inside what the keyboard leaves visible: leave the page where it is.
        if (box.top >= view.offsetTop + 8 && box.bottom <= view.offsetTop + view.height - 8) return
        field.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }, 300)
    }
    document.addEventListener('focusin', onFocusIn)
    return () => { document.removeEventListener('focusin', onFocusIn); window.clearTimeout(timer) }
  }, [])
}

/** True while the on-screen keyboard (or anything else) takes a real slice off the bottom of the window. */
export function keyboardIsOpen(view: VisibleViewport): boolean {
  return typeof window !== 'undefined' && view.height > 0 && window.innerHeight - view.height > 80
}

/**
 * Where a full-screen overlay should sit: the part of the screen the keyboard
 * leaves visible. Pass as `style` to a `fixed inset-x-0` box (with no top or
 * bottom class); before the first measurement it spans the whole window.
 * `short` says the visible area is small (keyboard up on a phone), for
 * layouts that shrink their header then.
 */
export function useVisibleBox(): { style: CSSProperties; short: boolean; keyboard: boolean } {
  const view = useVisibleViewport()
  const style: CSSProperties = view.height ? { top: view.top, height: view.height } : { top: 0, bottom: 0 }
  return { style, short: view.height > 0 && view.height < 560, keyboard: keyboardIsOpen(view) }
}
