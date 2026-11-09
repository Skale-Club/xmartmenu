'use client'

import { useState, type FocusEvent, type KeyboardEvent } from 'react'
import { AsYouType, getCountryCallingCode, getExampleNumber, parsePhoneNumberFromString, validatePhoneNumberLength, type CountryCode } from 'libphonenumber-js/core'
import metadata from 'libphonenumber-js/min/metadata'
import examples from 'libphonenumber-js/mobile/examples'
import PhoneCountryPicker from './PhoneCountryPicker'
import { phoneRegion, toE164Phone, type PhoneContext } from '@/components/menu/showcase'

/** A mobile number of that country written the local way ("(201) 555-0123", "(11) 96123-4567"): the field's placeholder. */
export function phonePlaceholder(country: CountryCode): string {
  return getExampleNumber(country, examples, metadata)?.formatNational() ?? ''
}

/**
 * The part of the country's example still to type, shown faintly after what was typed:
 * "(11) 9" + "6123-4567". Only while what was typed keeps the example's shape (same
 * brackets, spaces and dashes in the same places); empty otherwise.
 */
export function phoneGhost(display: string, template: string): string {
  if (!display || display.length >= template.length) return ''
  for (let i = 0; i < display.length; i++) {
    const typed = display[i], expected = template[i]
    if (/\d/.test(expected) ? !/\d/.test(typed) : typed !== expected) return ''
  }
  return template.slice(display.length)
}

/** What the parent keeps: the international number when it is a real one, else what was typed with its country code. */
export function phoneFieldValue(display: string, country: CountryCode): string {
  const typed = display.trim()
  if (!typed) return ''
  if (typed.startsWith('+')) return toE164Phone(typed) ?? typed
  return toE164Phone(typed, { country }) ?? `+${getCountryCallingCode(country, metadata)} ${typed}`
}

/** The country and the national text to show for a stored value ("+5511999998888" → BR, "(11) 99999-8888"). */
export function phoneFieldDisplay(value: string, fallback: CountryCode): { country: CountryCode; display: string } {
  const text = value.trim()
  if (!text.startsWith('+')) return { country: fallback, display: text }
  const parsed = parsePhoneNumberFromString(text, metadata)
  if (parsed?.country) return { country: parsed.country, display: parsed.formatNational() }
  // An incomplete "+44 7911" kept as typed: find its country from the code, show the rest.
  const match = /^\+(\d{1,3})\s+(.*)$/.exec(text)
  if (match) {
    const code = match[1]
    if (getCountryCallingCode(fallback, metadata) === code) return { country: fallback, display: match[2] }
  }
  return { country: fallback, display: text }
}

/**
 * A phone field the way the guest sign-in has it: the country (flag and
 * calling code, the restaurant's country first) and the number formatted as
 * it is typed for that country. `value`/`onChange` carry the full number
 * ("+5511999998888"), so whoever stores it never has to guess the country.
 */
export default function PhoneField({
  id, value, onChange, phoneContext = null, locale = 'en', countryLabel, countrySearchLabel,
  enterKeyHint = 'next', autoFocus = false, required = false, onFocus, onKeyDown, className = '', describedBy, tone = 'light', ghost = false,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  phoneContext?: PhoneContext | null
  locale?: string
  countryLabel: string
  countrySearchLabel: string
  enterKeyHint?: 'next' | 'done' | 'go' | 'send'
  autoFocus?: boolean
  required?: boolean
  onFocus?: (e: FocusEvent<HTMLInputElement>) => void
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
  /** Classes for the number input (height, border, focus ring). */
  className?: string
  describedBy?: string
  /** 'dark' on the platform's dark sign-in card (the country picker follows). */
  tone?: 'light' | 'dark'
  /** Show the rest of the country's example faintly while typing (the field must use px-4 and 16px text). */
  ghost?: boolean
}) {
  const home = phoneRegion(phoneContext)
  const [state, setState] = useState(() => ({ ...phoneFieldDisplay(value, home), emitted: value }))
  // The parent changed the number itself (cleared after an order, restored from a draft): show that.
  if (value !== state.emitted) setState({ ...phoneFieldDisplay(value, home), emitted: value })
  const { country, display } = state

  const commit = (nextDisplay: string, nextCountry: CountryCode) => {
    const out = phoneFieldValue(nextDisplay, nextCountry)
    setState({ country: nextCountry, display: nextDisplay, emitted: out })
    onChange(out)
  }
  const asTyped = (digits: string, iso: CountryCode) => (digits ? new AsYouType(iso, metadata).input(digits) : '')

  // Formatted as typed for the chosen country. A pasted "+1 330…" switches the country to match;
  // deleting a bracket or dash deletes the digit before it instead of being put straight back.
  const type = (next: string) => {
    if (next.trim().startsWith('+')) {
      const parsed = parsePhoneNumberFromString(next, metadata)
      // Only a complete, valid number moves the country, so typing "+4…" never flips it halfway.
      if (parsed?.country && parsed.isValid()) { commit(parsed.formatNational(), parsed.country); return }
      commit(next, country); return
    }
    let digits = next.replace(/\D/g, '')
    if (next.length < display.length && digits === display.replace(/\D/g, '')) digits = digits.slice(0, -1)
    // The mask: no more digits than a number of that country can have.
    if (validatePhoneNumberLength(digits, country, metadata) === 'TOO_LONG') return
    commit(asTyped(digits, country), country)
  }
  const choose = (iso: CountryCode) => {
    commit(display.trim().startsWith('+') ? display : asTyped(display.replace(/\D/g, ''), iso), iso)
  }

  const ghostText = ghost ? phoneGhost(display, phonePlaceholder(country)) : ''

  return (
    <div className="flex gap-2">
      <PhoneCountryPicker value={country} onChange={choose} label={countryLabel} searchLabel={countrySearchLabel} locale={locale} first={home} tone={tone} />
      <div className="relative min-w-0 flex-1">
        <input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder={phonePlaceholder(country)}
          enterKeyHint={enterKeyHint}
          value={display}
          onChange={e => type(e.target.value)}
          onFocus={onFocus}
          onKeyDown={onKeyDown}
          autoFocus={autoFocus}
          required={required}
          aria-describedby={describedBy}
          className={`w-full tabular-nums ${className}`}
        />
        {ghostText ? (
          // Same box and type as the input: the typed part is invisible, the rest of the example shows faintly.
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre border border-transparent px-4 text-[16px] tabular-nums">
            <span className="invisible">{display}</span>
            <span className={tone === 'dark' ? 'text-white/25' : 'text-zinc-400'}>{ghostText}</span>
          </span>
        ) : null}
      </div>
    </div>
  )
}
