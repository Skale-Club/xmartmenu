'use client'

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { CountryFlag } from '@/components/ui/PhoneCountryPicker'
import { menuLanguage } from './menu-i18n'

/** "EN", "PT"… for the closed picker; Traditional Chinese reads "TW" so it differs from "ZH". */
function shortCode(code: string): string {
  return code === 'zh-TW' ? 'TW' : code.toUpperCase()
}

/**
 * The menu's language switch: a pill with the current (Nucleo) flag that opens a small
 * list of the menu's languages (flag, native name, a check on the current one).
 * Replaces a native <select>, whose system list looked out of place.
 */
export default function LanguagePicker({ languages, value, onChange, label }: {
  languages: string[]
  value: string
  onChange: (lang: string) => void
  label: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const listId = useId()

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    // Above the sticky category bar (z-30) only while open; scrolling closes it.
    const onScroll = () => setOpen(false)
    document.addEventListener('pointerdown', onPointer)
    window.addEventListener('scroll', onScroll, { passive: true })
    // Focus the current language so arrow keys start from it.
    const current = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? listRef.current?.querySelector<HTMLElement>('[role="option"]')
    current?.focus({ preventScroll: true })
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('scroll', onScroll)
    }
  }, [open])

  function choose(lang: string) {
    setOpen(false)
    buttonRef.current?.focus()
    if (lang !== value) onChange(lang)
  }

  function onListKey(e: KeyboardEvent<HTMLUListElement>) {
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])]
    const at = items.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); buttonRef.current?.focus() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(at + 1) % items.length]?.focus() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(at - 1 + items.length) % items.length]?.focus() }
    else if (e.key === 'Home') { e.preventDefault(); items[0]?.focus() }
    else if (e.key === 'End') { e.preventDefault(); items[items.length - 1]?.focus() }
    else if (e.key === 'Tab') setOpen(false)
  }

  return (
    <div ref={rootRef} className={`relative ${open ? 'z-40' : ''}`}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`${label}: ${menuLanguage(value).nativeName}`}
        title={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true) } }}
        className="flex h-10 items-center gap-1.5 rounded-full bg-white/95 pl-2.5 pr-2 text-[14px] font-semibold text-zinc-900 shadow-sm transition-[scale] active:scale-95"
      >
        <CountryFlag iso={menuLanguage(value).flag} className="size-6" />
        <span>{shortCode(value)}</span>
        <ChevronDown className={`size-4 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          onKeyDown={onListKey}
          className="absolute right-0 top-full z-30 mt-2 max-h-[min(60vh,22rem)] min-w-44 overflow-y-auto rounded-2xl bg-white p-1.5 shadow-xl ring-1 ring-black/5"
        >
          {languages.map(code => {
            const selected = code === value
            return (
              <li
                key={code}
                role="option"
                aria-selected={selected}
                tabIndex={-1}
                onClick={() => choose(code)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(code) } }}
                className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] outline-none transition-colors hover:bg-zinc-100 focus-visible:bg-zinc-100 ${selected ? 'font-semibold text-zinc-900' : 'text-zinc-700'}`}
              >
                <CountryFlag iso={menuLanguage(code).flag} className="size-7" />
                <span className="flex-1 whitespace-nowrap">{menuLanguage(code).nativeName}</span>
                {selected && <Check className="size-4 text-zinc-900" aria-hidden="true" />}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
