'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ACCESS_REQUEST_STEPS, BUSINESS_TYPES, CONTACT_TIMES, CURRENT_MENUS, INTERESTS, LANGUAGES, LOCATION_COUNTS, MENU_SIZES,
  type AccessRequestAnswers, type AccessRequestStep, type ApplicantState,
} from '@/lib/access-requests/contract'
import PhoneField from '@/components/ui/PhoneField'
import { keepFieldVisible, nextFieldOnEnter } from '@/components/ui/keyboard-fields'
import { STRINGS, type Strings } from './strings'
import {
  buildSubmitPayload, cleanAnswers, clearLocal, detectLanguage, detectRegion, lastStepIndex, localKey, pickRestore,
  readLocal, stepIndexOf, validateStep, writeLocal, type Language, type Snapshot,
} from './survey-state'

type Applicant = Exclude<ApplicantState, { status: 'has_restaurant' }>
type Phase = { kind: 'loading' } | { kind: 'error' } | { kind: 'flow' } | { kind: 'pending' } | { kind: 'declined' }

const FETCH_INIT = { credentials: 'same-origin', cache: 'no-store', redirect: 'error' } as const
const JSON_HEADERS = { 'Content-Type': 'application/json' }

const input = 'w-full rounded-xl border border-white/15 bg-zinc-950 px-4 py-3 text-[16px] text-platform-ivory placeholder:text-zinc-400 disabled:opacity-50'
const primary = 'min-h-11 rounded-full bg-primary px-6 py-3 font-bold text-primary-foreground disabled:opacity-50'
const secondary = 'min-h-11 rounded-full border border-white/15 px-5 py-3 font-semibold text-platform-ivory disabled:opacity-40'

export default function AccessRequestFlow({ teamWhatsApp }: { teamWhatsApp: string | null }) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [applicant, setApplicant] = useState<Applicant | null>(null)
  const [answers, setAnswers] = useState<AccessRequestAnswers>({})
  const [index, setIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [optIn, setOptIn] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const stepsRef = useRef({ depth: 0 })
  const content = useRef<HTMLDivElement>(null)
  const key = localKey(null)

  const lang: Language = answers.language ?? 'en'
  const t = STRINGS[lang]
  const region = typeof navigator === 'undefined' ? null : detectRegion(navigator.language)

  // Load the state, restore the draft (server wins unless this browser's copy is newer).
  useEffect(() => {
    let cancelled = false
    fetch('/api/access-request', FETCH_INIT)
      .then(async res => {
        if (!res.ok) throw new Error('load')
        const state = (await res.json()) as ApplicantState
        if (cancelled) return
        if (state.status === 'has_restaurant') { router.replace('/dashboard'); return }
        setApplicant(state)
        if (state.answers?.language) setAnswers(a => ({ ...a, language: state.answers.language }))
        if (state.status === 'pending' || state.status === 'approved') { setPhase({ kind: 'pending' }); return }
        if (state.status === 'declined') { setPhase({ kind: 'declined' }); return }
        const server: Snapshot = { step: ACCESS_REQUEST_STEPS[stepIndexOf(state.step)], answers: state.answers ?? {}, savedAt: null }
        const picked = pickRestore(server, readLocal(key))
        const restored: AccessRequestAnswers = { ...(picked?.answers ?? {}) }
        restored.language ??= detectLanguage(navigator.language)
        if (!restored.contactPhone && state.prefill?.phone) restored.contactPhone = state.prefill.phone
        const start = picked ? stepIndexOf(picked.step) : 0
        // One history entry per step already passed, so the browser Back button walks back through them.
        for (let i = 0; i < start; i++) history.pushState({ xmAccessRequest: i + 1 }, '')
        stepsRef.current.depth = start
        setAnswers(restored); setIndex(start); setPhase({ kind: 'flow' })
      })
      .catch(() => { if (!cancelled) setPhase({ kind: 'error' }) })
    return () => { cancelled = true }
  }, [router, key, reloadKey])

  // Browser back = previous question.
  useEffect(() => {
    if (phase.kind !== 'flow') return
    const onPop = () => {
      if (stepsRef.current.depth > 0) {
        stepsRef.current.depth -= 1
        setError(null); setIndex(i => Math.max(0, i - 1))
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [phase.kind])

  // Local backup on every change.
  useEffect(() => {
    if (phase.kind !== 'flow') return
    writeLocal(key, { step: ACCESS_REQUEST_STEPS[index], answers })
  }, [phase.kind, key, index, answers])

  const step = ACCESS_REQUEST_STEPS[index]
  const isLast = index === lastStepIndex

  // Focus the text input on text steps, else the heading; keep the field above the keyboard.
  useLayoutEffect(() => {
    if (phase.kind !== 'flow' || !content.current) return
    const el = content.current
    el.scrollTop = 0
    const target = el.querySelector<HTMLInputElement>('input[data-autofocus]') ?? el.querySelector<HTMLElement>('h1')
    target?.focus({ preventScroll: true })
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const active = document.activeElement
      if (!(active instanceof HTMLInputElement) || !el.contains(active)) return
      const f = active.getBoundingClientRect(), b = el.getBoundingClientRect()
      if (f.bottom > b.bottom - 12) el.scrollTop += f.bottom - b.bottom + 12
      else if (f.top < b.top + 12) el.scrollTop -= b.top - f.top + 12
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [phase.kind, index])

  const set = useCallback(<K extends keyof AccessRequestAnswers>(k: K, v: AccessRequestAnswers[K]) => {
    setAnswers(prev => ({ ...prev, [k]: v })); setError(null)
  }, [])

  // Silent autosave: never blocks the user; the next step sends everything again.
  const saveDraft = useCallback((next: AccessRequestStep, data: AccessRequestAnswers) => {
    void fetch('/api/access-request', { ...FETCH_INIT, method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ step: next, answers: cleanAnswers(data) }) }).catch(() => {})
  }, [])

  const advance = (skipping: boolean) => {
    const data = skipping ? clearOptional(step, answers) : answers
    if (skipping) setAnswers(data)
    else {
      const problem = validateStep(step, data)
      if (problem) { setError(t.errors[problem]); return }
    }
    const nextStep = ACCESS_REQUEST_STEPS[Math.min(index + 1, lastStepIndex)]
    saveDraft(nextStep, data)
    history.pushState({ xmAccessRequest: index + 1 }, '')
    stepsRef.current.depth += 1
    setError(null); setIndex(index + 1)
  }

  const goBack = () => {
    if (index === 0) return
    if (stepsRef.current.depth > 0) history.back()
    else { setError(null); setIndex(index - 1) }
  }

  const submit = async () => {
    const problem = validateStep(step, answers)
    if (problem) { setError(t.errors[problem]); return }
    setSubmitting(true); setError(null)
    try {
      const res = await fetch('/api/access-request', { ...FETCH_INIT, method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(buildSubmitPayload(answers, optIn)) })
      if (res.ok || res.status === 409) { clearLocal(key); setPhase({ kind: 'pending' }); return }
      const body = await res.json().catch(() => null) as { error?: string } | null
      setError(typeof body?.error === 'string' ? body.error : t.errors.generic)
    } catch { setError(t.errors.generic) } finally { setSubmitting(false) }
  }

  const onEnter = () => (isLast ? void submit() : advance(false))

  if (phase.kind === 'loading') return <Frame><p className="text-center text-zinc-400" role="status">{t.loading}</p></Frame>
  if (phase.kind === 'error') {
    return <Frame><p role="alert" className="text-center text-red-300">{t.errors.load}</p>
      <button type="button" className={`${primary} mx-auto mt-5 block`} onClick={() => { setPhase({ kind: 'loading' }); setReloadKey(k => k + 1) }}>{t.errors.retry}</button></Frame>
  }
  if (phase.kind === 'pending') {
    return <Frame><Closing title={t.pending.title} text={t.pending.text} t={t} whatsApp={teamWhatsApp} showSignOut /></Frame>
  }
  if (phase.kind === 'declined') {
    return <Frame><Closing title={t.declined.title} text={t.declined.text} t={t} whatsApp={teamWhatsApp} showSignOut /></Frame>
  }

  const copy = t.steps[step]
  const optional = !['language', 'businessName', 'businessType', 'location', 'contact'].includes(step)
  const hasApplicant = applicant !== null

  return (
    <Frame wide>
      <form
        onSubmit={e => { e.preventDefault(); onEnter() }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="shrink-0">
          <div role="progressbar" aria-valuemin={1} aria-valuemax={ACCESS_REQUEST_STEPS.length} aria-valuenow={index + 1} aria-label={t.stepOf(index + 1, ACCESS_REQUEST_STEPS.length)} className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-primary-on-dark transition-all" style={{ width: `${((index + 1) / ACCESS_REQUEST_STEPS.length) * 100}%` }} />
          </div>
          <p className="mt-2 text-xs text-zinc-400">{t.stepOf(index + 1, ACCESS_REQUEST_STEPS.length)}</p>
        </div>

        <div key={step} ref={content} className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-6">
          <h1 tabIndex={-1} className="text-2xl font-bold leading-tight outline-none sm:text-3xl">{copy.title}</h1>
          {copy.helper ? <p className="mt-2 text-sm text-zinc-400">{copy.helper}</p> : null}
          <div className="mt-6 space-y-4">
            <StepFields
              step={step} answers={answers} set={set} t={t} region={region} lang={lang} disabled={submitting || !hasApplicant}
              onChoose={(k, v) => set(k, v as never)} onEnter={onEnter}
            />
            {isLast ? (
              <label className="flex items-start gap-3 pt-2 text-left text-sm text-zinc-300">
                <input type="checkbox" checked={optIn} onChange={e => setOptIn(e.target.checked)} disabled={submitting} className="mt-0.5 h-5 w-5 rounded border-white/20 accent-platform-ivory" />
                <span>{t.whatsappConsent}</span>
              </label>
            ) : null}
          </div>
          {error ? <p role="alert" className="mt-4 text-sm text-red-300">{error}</p> : null}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-white/10 pt-4">
          <button type="button" className={secondary} onClick={goBack} disabled={index === 0 || submitting}>{t.back}</button>
          <div className="flex gap-2">
            {optional && !isLast ? <button type="button" className={secondary} onClick={() => advance(true)} disabled={submitting}>{t.skip}</button> : null}
            <button type="submit" className={primary} disabled={submitting}>
              {isLast ? (submitting ? t.sending : t.send) : t.next}
            </button>
          </div>
        </div>
      </form>
    </Frame>
  )
}

/** Skipping an optional step forgets what was half-typed there. */
function clearOptional(step: AccessRequestStep, a: AccessRequestAnswers): AccessRequestAnswers {
  const next = { ...a }
  if (step === 'interests') delete next.interests
  else if (step === 'socialUrl') delete next.socialUrl
  else if (step === 'locations' || step === 'currentMenu' || step === 'menuSize' || step === 'contactTime') delete next[step]
  return next
}

function Frame({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <main data-testid="access-request-flow" className="platform-dark fixed inset-0 flex justify-center bg-zinc-950 px-5 text-platform-ivory">
      <div className={`flex min-h-0 w-full flex-col py-5 ${wide ? 'max-w-xl' : 'max-w-md justify-center'}`}>
        <p className="mb-4 shrink-0 font-black">Xprout</p>
        {wide ? children : <section className="rounded-3xl border border-white/10 bg-zinc-900/60 p-6 sm:p-8">{children}</section>}
      </div>
    </main>
  )
}

function Closing({ title, text, t, whatsApp, showSignOut }: { title: string; text: string; t: Strings; whatsApp: string | null; showSignOut: boolean }) {
  const digits = whatsApp?.replace(/\D/g, '') ?? ''
  const href = digits ? `https://wa.me/${digits}?text=${encodeURIComponent(t.pending.whatsappMessage)}` : null
  return (
    <div className="space-y-5 text-center">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="text-sm leading-6 text-zinc-400">{text}</p>
      {href ? <a href={href} target="_blank" rel="noopener noreferrer" className={`${primary} inline-flex items-center justify-center`}>{t.pending.whatsapp}</a> : null}
      {showSignOut ? (
        <form action="/api/auth/signout" method="post"><button type="submit" className="min-h-11 text-sm text-zinc-400 underline">{t.pending.signOut}</button></form>
      ) : null}
    </div>
  )
}

function Choice({ selected, onClick, children, multi, disabled }: { selected: boolean; onClick: () => void; children: React.ReactNode; multi?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      role={multi ? 'checkbox' : 'radio'} aria-checked={selected}
      className={`min-h-12 w-full rounded-xl border px-4 py-3 text-left font-semibold transition-colors disabled:opacity-50 ${selected ? 'border-primary-on-dark bg-primary/15 text-platform-ivory' : 'border-white/15 bg-zinc-900 text-zinc-200 hover:border-white/30'}`}
    >{children}</button>
  )
}

function StepFields({ step, answers, set, t, region, lang, disabled, onChoose, onEnter }: {
  step: AccessRequestStep; answers: AccessRequestAnswers
  set: <K extends keyof AccessRequestAnswers>(k: K, v: AccessRequestAnswers[K]) => void
  t: Strings; region: string | null; lang: Language; disabled: boolean
  onChoose: (k: keyof AccessRequestAnswers, v: unknown) => void; onEnter: () => void
}) {
  const single = <T extends string>(k: 'locations' | 'currentMenu' | 'menuSize' | 'contactTime', values: readonly T[], labels: Record<string, string>) => (
    <div role="radiogroup" className="grid gap-2">
      {values.map(v => <Choice key={v} selected={answers[k] === v} disabled={disabled} onClick={() => onChoose(k, v)}>{labels[v]}</Choice>)}
    </div>
  )
  switch (step) {
    case 'language':
      return <div role="radiogroup" className="grid gap-2">
        {LANGUAGES.map(l => <Choice key={l} selected={answers.language === l} disabled={disabled} onClick={() => onChoose('language', l)}>{t.languages[l]}</Choice>)}
      </div>
    case 'businessName':
      return <input data-autofocus id="ar-business" aria-label={t.fields.businessName} className={input} autoComplete="organization" enterKeyHint="next" maxLength={120} value={answers.businessName ?? ''}
        onChange={e => set('businessName', e.target.value)} onFocus={keepFieldVisible} disabled={disabled} />
    case 'businessType':
      return <>
        <div role="radiogroup" className="grid grid-cols-2 gap-2">
          {BUSINESS_TYPES.map(b => <Choice key={b} selected={answers.businessType === b} disabled={disabled} onClick={() => onChoose('businessType', b)}>{t.businessTypes[b]}</Choice>)}
        </div>
        {answers.businessType === 'other' ? (
          <input data-autofocus aria-label={t.fields.businessTypeOther} placeholder={t.fields.businessTypeOther} className={input} maxLength={120} value={answers.businessTypeOther ?? ''}
            onChange={e => set('businessTypeOther', e.target.value)} onFocus={keepFieldVisible} disabled={disabled} />
        ) : null}
      </>
    case 'location':
      return <input data-autofocus aria-label={t.fields.location} placeholder={t.fields.location} className={input} autoComplete="street-address" enterKeyHint="next" maxLength={200} value={answers.location ?? ''}
        onChange={e => set('location', e.target.value)} onFocus={keepFieldVisible} disabled={disabled} />
    case 'contact':
      return <>
        <div>
          <label htmlFor="ar-phone" className="mb-1 block text-sm font-semibold">{t.fields.phone}</label>
          <PhoneField id="ar-phone" value={answers.contactPhone ?? ''} onChange={v => set('contactPhone', v)} phoneContext={{ country: region }} locale={lang}
            countryLabel={t.fields.countryLabel} countrySearchLabel={t.fields.countrySearch} required tone="dark" onFocus={keepFieldVisible} onKeyDown={nextFieldOnEnter}
            className="rounded-xl border border-white/15 bg-zinc-950 px-4 py-3 text-[16px] text-platform-ivory" />
        </div>
        <div>
          <label htmlFor="ar-email" className="mb-1 block text-sm font-semibold">{t.fields.email}</label>
          <input id="ar-email" type="email" inputMode="email" autoComplete="email" enterKeyHint="done" maxLength={200} className={input} value={answers.contactEmail ?? ''}
            onChange={e => set('contactEmail', e.target.value)} onFocus={keepFieldVisible} onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); onEnter() } }} disabled={disabled} />
        </div>
      </>
    case 'locations': return single('locations', LOCATION_COUNTS, t.locations)
    case 'currentMenu': return single('currentMenu', CURRENT_MENUS, t.currentMenus)
    case 'menuSize': return single('menuSize', MENU_SIZES, t.menuSizes)
    case 'contactTime': return single('contactTime', CONTACT_TIMES, t.contactTimes)
    case 'interests': {
      const current = answers.interests ?? []
      return <div className="grid gap-2">
        {INTERESTS.map(i => (
          <Choice key={i} multi selected={current.includes(i)} disabled={disabled}
            onClick={() => set('interests', current.includes(i) ? current.filter(x => x !== i) : [...current, i])}>{t.interests[i]}</Choice>
        ))}
      </div>
    }
    case 'socialUrl':
      return <input data-autofocus aria-label={t.steps.socialUrl.title} placeholder={t.fields.social} className={input} inputMode="url" autoCapitalize="none" enterKeyHint="next" maxLength={300} value={answers.socialUrl ?? ''}
        onChange={e => set('socialUrl', e.target.value)} onFocus={keepFieldVisible} disabled={disabled} />
  }
}
