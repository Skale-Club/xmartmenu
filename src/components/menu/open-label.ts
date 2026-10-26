/**
 * The open/closed line under the restaurant's name, in the guest's language.
 * Hours a restaurant writes as free text ("Pickup by confirmation") are shown
 * as written ("Today: Pickup by confirmation") instead of guessing.
 */
import type { OpenState } from '@/lib/chat-context'
import type { GuestCopy } from './guest-copy'
import { fill, formatClock, formatWeekday, type MenuCopy } from './menu-i18n'

export interface OpenLabel {
  text: string
  /** open: green dot; closed: grey dot; info: free text, no claim either way. */
  tone: 'open' | 'closed' | 'info'
}

export function describeOpenState(
  state: OpenState,
  copy: Pick<MenuCopy, 'openUntil' | 'closed' | 'closedOpensToday' | 'closedOpensTomorrow' | 'closedOpensOn'>,
  guest: Pick<GuestCopy, 'todayHours' | 'closedNextHours'>,
  lang: string,
): OpenLabel | null {
  if (state.kind === 'open') return { text: fill(copy.openUntil, { time: formatClock(state.closesAt, lang) }), tone: 'open' }
  if (state.kind === 'closed') {
    if (state.opens) {
      const time = formatClock(state.opens.minutes, lang)
      if (state.opens.inDays === 0) return { text: fill(copy.closedOpensToday, { time }), tone: 'closed' }
      if (state.opens.inDays === 1) return { text: fill(copy.closedOpensTomorrow, { time }), tone: 'closed' }
      return { text: fill(copy.closedOpensOn, { day: formatWeekday(state.opens.dayIndex, lang), time }), tone: 'closed' }
    }
    if (state.nextText?.text.trim()) {
      return { text: fill(guest.closedNextHours, { day: formatWeekday(state.nextText.dayIndex, lang), text: state.nextText.text.trim() }), tone: 'closed' }
    }
    return { text: copy.closed, tone: 'closed' }
  }
  if (state.reason === 'free-text' && state.text?.trim()) {
    return { text: fill(guest.todayHours, { text: state.text.trim() }), tone: 'info' }
  }
  return null
}

/**
 * The restaurant's time zone from its profile, else the guest's own (guests
 * reading a menu are almost always in the same place as the restaurant).
 */
export function menuTimeZone(profileZone: string | null, deviceZone: string | null | undefined): string | null {
  if (profileZone) return profileZone
  const zone = deviceZone?.trim()
  if (!zone) return null
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return zone
  } catch {
    return null
  }
}
