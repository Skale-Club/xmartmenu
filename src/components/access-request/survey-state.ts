import {
  ACCESS_REQUEST_STEPS, LANGUAGES, REQUIRED_STEPS, SUBMITTED_STEP, draftAnswersSchema,
  type AccessRequestAnswers, type AccessRequestStep,
} from '@/lib/access-requests/contract'

/** Pure state helpers of the questionnaire (no React, no DOM), so they can be unit tested. */

export type Language = (typeof LANGUAGES)[number]
export type StepError = 'required' | 'phone' | 'email' | null

export const LOCAL_KEY_PREFIX = 'xm_access_request'
export const lastStepIndex = ACCESS_REQUEST_STEPS.length - 1

export function stepIndexOf(step: string | undefined | null): number {
  if (step === SUBMITTED_STEP) return lastStepIndex
  const i = ACCESS_REQUEST_STEPS.indexOf(step as AccessRequestStep)
  return i < 0 ? 0 : i
}

export function detectLanguage(nav: string | undefined | null): Language {
  const code = (nav ?? '').toLowerCase().slice(0, 2)
  return code === 'pt' || code === 'es' ? code : 'en'
}

/** Region ("BR" of "pt-BR") for the phone field's default country. */
export function detectRegion(nav: string | undefined | null): string | null {
  const m = /[-_]([A-Za-z]{2})\b/.exec(nav ?? '')
  return m ? m[1].toUpperCase() : null
}

export function isRequired(step: AccessRequestStep): boolean {
  return REQUIRED_STEPS.includes(step)
}

const phoneDigits = (v: string) => v.replace(/\D/g, '')
const PHONE_RE = /^\+?[0-9 ()\-.]{6,40}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** Why the step cannot continue, or null. Optional steps only fail on malformed input. */
export function validateStep(step: AccessRequestStep, a: AccessRequestAnswers): StepError {
  switch (step) {
    case 'language': return a.language ? null : 'required'
    case 'businessName': return (a.businessName ?? '').trim().length >= 2 ? null : 'required'
    case 'businessType':
      if (!a.businessType) return 'required'
      if (a.businessType === 'other' && !(a.businessTypeOther ?? '').trim()) return 'required'
      return null
    case 'location': return (a.location ?? '').trim().length >= 2 ? null : 'required'
    case 'contact': {
      const phone = (a.contactPhone ?? '').trim()
      if (!phone) return 'required'
      if (!PHONE_RE.test(phone) || phoneDigits(phone).length < 6) return 'phone'
      const email = (a.contactEmail ?? '').trim()
      return email && !EMAIL_RE.test(email) ? 'email' : null
    }
    default: return null
  }
}

/** True when the step holds an answer (drives Continue vs Skip on optional steps). */
export function stepFilled(step: AccessRequestStep, a: AccessRequestAnswers): boolean {
  switch (step) {
    case 'interests': return (a.interests?.length ?? 0) > 0
    case 'socialUrl': return !!a.socialUrl?.trim()
    case 'locations': case 'currentMenu': case 'menuSize': case 'contactTime': return !!a[step]
    default: return validateStep(step, a) === null
  }
}

/** Answers as the server's schemas accept them: trimmed, no empty values, no stray keys. */
export function cleanAnswers(a: AccessRequestAnswers): AccessRequestAnswers {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(a)) {
    if (typeof v === 'string') { const t = v.trim(); if (t) out[k] = t }
    else if (Array.isArray(v)) { if (v.length) out[k] = v }
    else if (v !== undefined && v !== null) out[k] = v
  }
  if (out.businessType !== 'other') delete out.businessTypeOther
  const parsed = draftAnswersSchema.safeParse(out)
  return parsed.success ? parsed.data : {}
}

export function buildSubmitPayload(answers: AccessRequestAnswers, whatsappOptIn: boolean) {
  return { answers: cleanAnswers(answers), whatsappOptIn }
}

export interface Snapshot { step: AccessRequestStep; answers: AccessRequestAnswers; savedAt?: number | null }

const hasAnswers = (a: AccessRequestAnswers) => Object.keys(cleanAnswers(a)).length > 0

/**
 * Which copy to restore. The server wins unless the browser copy is newer.
 * The server may not say when it was saved (savedAt null): then the copy
 * that got further wins, a tie going to the server.
 */
export function pickRestore(server: Snapshot | null, local: Snapshot | null): Snapshot | null {
  const s = server && hasAnswers(server.answers) ? server : null
  const l = local && hasAnswers(local.answers) ? local : null
  if (!s) return l
  if (!l) return s
  if (typeof s.savedAt === 'number' && typeof l.savedAt === 'number') return l.savedAt > s.savedAt ? l : s
  return stepIndexOf(l.step) > stepIndexOf(s.step) ? l : s
}

export function localKey(userHint: string | null | undefined): string {
  return `${LOCAL_KEY_PREFIX}:${userHint ?? 'me'}`
}

export function readLocal(key: string): Snapshot | null {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (!raw || typeof raw !== 'object') return null
    const parsed = draftAnswersSchema.safeParse(raw.answers ?? {})
    if (!parsed.success) return null
    return { step: ACCESS_REQUEST_STEPS[stepIndexOf(raw.step)], answers: parsed.data, savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : null }
  } catch { return null }
}

export function writeLocal(key: string, snap: Snapshot): void {
  try { localStorage.setItem(key, JSON.stringify({ step: snap.step, answers: cleanAnswers(snap.answers), savedAt: snap.savedAt ?? Date.now() })) } catch { /* private mode */ }
}

export function clearLocal(key: string): void {
  try { localStorage.removeItem(key) } catch { /* ignore */ }
}
