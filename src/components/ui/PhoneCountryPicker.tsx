'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search } from 'lucide-react'
import { getCountries, getCountryCallingCode, type CountryCode } from 'libphonenumber-js/core'
import metadata from 'libphonenumber-js/min/metadata'

/** Small territories the Nucleo set has no drawing for: a neutral chip stands in. */
const NO_FLAG = new Set(['AC', 'AI', 'AS', 'BL', 'BQ', 'CC', 'CX', 'GU', 'IO', 'MF', 'MP', 'MS', 'NF', 'PM', 'RE', 'SH', 'SJ', 'SY', 'TA', 'TK', 'WF', 'YT'])
/** Shown first, after the restaurant's own country. */
const COMMON: CountryCode[] = ['US', 'BR', 'MX', 'CA', 'GB', 'PT', 'ES', 'FR', 'DE', 'IT', 'AR', 'CO']

const GAP = 6
const EDGE = 8
const POPUP_ID = 'phone-country-picker'

/** A Nucleo flag (public/flags/nucleo, 32×32 with the flag drawn 30×24 in the middle). */
export function CountryFlag({ iso, className = 'size-6' }: { iso: string; className?: string }) {
  if (NO_FLAG.has(iso)) {
    return <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center ${className}`}><span className="h-[75%] w-[94%] rounded-[3px] bg-zinc-200" /></span>
  }
  // eslint-disable-next-line @next/next/no-img-element -- tiny static SVGs; next/image would add nothing.
  return <img src={`/flags/nucleo/${iso.toLowerCase()}.svg`} alt="" aria-hidden="true" loading="lazy" decoding="async" className={`shrink-0 ${className}`} />
}

interface Option { iso: CountryCode; name: string; code: string }

/**
 * The country next to a phone field, as in Xpot: flag and calling code on a
 * button, a searchable list with every country (names in the menu's
 * language) and the restaurant's country first. The list is measured against
 * what the phone keyboard leaves visible, so it never opens behind it.
 */
export default function PhoneCountryPicker({ value, onChange, label, searchLabel, locale, first }: {
  value: CountryCode
  onChange: (iso: CountryCode) => void
  /** Accessible name ("Country"). */
  label: string
  searchLabel: string
  /** BCP 47 locale for the country names. */
  locale: string
  /** The restaurant's country: top of the list. */
  first?: CountryCode | null
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [position, setPosition] = useState<CSSProperties | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const { top, rest } = useMemo(() => {
    let names: Intl.DisplayNames | null = null
    try { names = new Intl.DisplayNames([locale, 'en'], { type: 'region' }) } catch { names = null }
    const all: Option[] = getCountries(metadata).map(iso => ({
      iso,
      name: names?.of(iso) ?? iso,
      code: getCountryCallingCode(iso, metadata),
    }))
    const byIso = new Map(all.map(o => [o.iso, o]))
    const topIsos = [...new Set([first, ...COMMON].filter((iso): iso is CountryCode => !!iso && byIso.has(iso)))]
    const topSet = new Set(topIsos)
    return {
      top: topIsos.map(iso => byIso.get(iso)!),
      rest: all.filter(o => !topSet.has(o.iso)).sort((a, b) => a.name.localeCompare(b.name, locale)),
    }
  }, [locale, first])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^\+/, '')
    if (!q) return [...top, ...rest]
    const plain = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
    return [...top, ...rest].filter(o => plain(o.name).includes(plain(q)) || o.code.startsWith(q) || o.iso.toLowerCase() === q)
  }, [query, top, rest])

  const current = [...top, ...rest].find(o => o.iso === value)
  const callingCode = current?.code ?? getCountryCallingCode(value, metadata)

  const place = useCallback(() => {
    const trigger = rootRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const view = window.visualViewport
    const viewTop = view?.offsetTop ?? 0
    const viewBottom = viewTop + (view?.height ?? window.innerHeight)
    const wanted = 360
    const below = viewBottom - rect.bottom - EDGE - GAP
    const above = rect.top - viewTop - EDGE - GAP
    const placeBelow = below >= Math.min(wanted, 220) || below >= above
    const maxHeight = Math.max(160, Math.min(wanted, placeBelow ? below : above))
    const width = Math.min(320, window.innerWidth - EDGE * 2)
    const left = Math.max(EDGE, Math.min(rect.left, window.innerWidth - width - EDGE))
    setPosition({ left, width, maxHeight, top: placeBelow ? rect.bottom + GAP : Math.max(viewTop + EDGE, rect.top - GAP - maxHeight) })
  }, [])

  useEffect(() => {
    if (!open) return
    place()
    const view = window.visualViewport
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    view?.addEventListener('resize', place)
    view?.addEventListener('scroll', place)
    const outside = (e: PointerEvent) => {
      const target = e.target as Node
      if (!rootRef.current?.contains(target) && !popupRef.current?.contains(target)) setOpen(false)
    }
    // Escape closes the list, not the dialog around it (capture runs before the dialog's handler).
    const escape = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation(); e.preventDefault()
      setOpen(false)
      rootRef.current?.querySelector('button')?.focus()
    }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', escape, { capture: true })
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      view?.removeEventListener('resize', place)
      view?.removeEventListener('scroll', place)
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('keydown', escape, { capture: true })
    }
  }, [open, place])

  useEffect(() => {
    if (!open) return
    popupRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const show = () => {
    setQuery('')
    setActive(Math.max(0, [...top, ...rest].findIndex(o => o.iso === value)))
    place()
    setOpen(true)
    // Searching is one tap away on phones; a mouse or keyboard user can type at once.
    if (window.matchMedia('(pointer: fine)').matches) requestAnimationFrame(() => searchRef.current?.focus())
  }
  const pick = (iso: CountryCode) => {
    onChange(iso)
    setOpen(false)
    rootRef.current?.querySelector('button')?.focus()
  }
  const onKey = (e: KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); show() }
      return
    }
    const last = visible.length - 1
    if (e.key === 'ArrowDown') setActive(i => (i >= last ? 0 : i + 1))
    else if (e.key === 'ArrowUp') setActive(i => (i <= 0 ? last : i - 1))
    else if (e.key === 'Enter') { if (visible[active]) pick(visible[active].iso) }
    else if (e.key === 'Tab') { setOpen(false); return }
    else return
    e.preventDefault()
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={POPUP_ID}
        aria-label={`${label}: ${current?.name ?? value} +${callingCode}`}
        data-testid="phone-country"
        className="flex h-12 items-center gap-1.5 rounded-xl border border-zinc-300 bg-white pl-2.5 pr-2 text-[16px] text-zinc-950 transition-[border-color,box-shadow] hover:border-zinc-400 focus:border-[var(--accent,#18181b)] focus:outline-none focus:ring-[3px] focus:ring-[color-mix(in_srgb,var(--accent,#18181b)_22%,transparent)]"
      >
        <CountryFlag iso={value} />
        <span className="tabular-nums">+{callingCode}</span>
        <ChevronDown className={`size-4 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && position && createPortal(
        <div
          ref={popupRef}
          style={position}
          className="fixed z-[100] flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_12px_40px_rgb(0_0_0/0.18)]"
        >
          <div className="relative border-b border-zinc-200 p-2">
            <Search className="pointer-events-none absolute left-5 top-1/2 size-4 -translate-y-1/2 text-zinc-500" aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={e => { setQuery(e.target.value); setActive(0) }}
              onKeyDown={onKey}
              placeholder={searchLabel}
              aria-label={searchLabel}
              aria-controls={POPUP_ID}
              enterKeyHint="done"
              className="h-10 w-full rounded-lg bg-zinc-100 pl-9 pr-3 text-[16px] text-zinc-950 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-300"
            />
          </div>
          <ul id={POPUP_ID} role="listbox" aria-label={label} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
            {visible.map((o, i) => (
              <li
                key={o.iso}
                data-index={i}
                role="option"
                aria-selected={o.iso === value}
                onPointerEnter={() => setActive(i)}
                onPointerDown={e => e.preventDefault()}
                onClick={() => pick(o.iso)}
                className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2.5 text-[15px] text-zinc-900 ${i === active ? 'bg-zinc-100' : ''} ${!query && i === top.length ? 'mt-1 border-t border-zinc-200 pt-1' : ''}`}
              >
                <CountryFlag iso={o.iso} />
                <span className="min-w-0 flex-1 truncate">{o.name}</span>
                <span className="tabular-nums text-zinc-600">+{o.code}</span>
                {o.iso === value ? <Check className="size-4 text-zinc-900" aria-hidden="true" /> : <span className="size-4" />}
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  )
}
