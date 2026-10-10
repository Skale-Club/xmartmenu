'use client'

import type {
  AnalyticsBatchInput,
  AnalyticsSessionInput,
  ClientAnalyticsEventInput,
} from './contracts'

const SESSION_TIMEOUT_MS = 30 * 60 * 1000
const FLUSH_INTERVAL_MS = 5_000
const FLUSH_BATCH_SIZE = 20
const MAX_MEMORY_EVENTS = 100
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type TrackEvent = Omit<ClientAnalyticsEventInput, 'client_event_id' | 'occurred_at'> & {
  occurred_at?: string
}

type StoredSession = {
  id: string
  lastSeenAt: number
}

export interface MenuAnalyticsTrackerOptions {
  tenantId: string
  menuId: string
  locationId?: string | null
  qrCodeId?: string | null
  entrySource?: AnalyticsSessionInput['entry_source']
  language?: string | null
  isTest?: boolean
}

function deviceClass(): AnalyticsSessionInput['device_class'] {
  if (typeof window === 'undefined') return 'unknown'
  if (window.matchMedia('(max-width: 767px)').matches) return 'mobile'
  if (window.matchMedia('(max-width: 1023px)').matches) return 'tablet'
  return 'desktop'
}

function createId(): string {
  return crypto.randomUUID()
}

export class MenuAnalyticsTracker {
  readonly sessionId: string
  readonly isNewSession: boolean

  private readonly session: AnalyticsSessionInput
  private readonly storageKey: string
  private readonly impressionProductIds = new Set<string>()
  private queue: ClientAnalyticsEventInput[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private flushing = false
  private destroyed = false

  constructor(options: MenuAnalyticsTrackerOptions) {
    this.storageKey = [
      'xmartmenu:analytics',
      options.tenantId,
      options.menuId,
      options.locationId ?? '-',
      options.isTest ? 'test' : 'live',
    ].join(':')

    const now = Date.now()
    const stored = this.readStoredSession()
    const canReuse = stored && now - stored.lastSeenAt < SESSION_TIMEOUT_MS
    this.sessionId = canReuse ? stored.id : createId()
    this.isNewSession = !canReuse
    this.session = {
      id: this.sessionId,
      tenant_id: options.tenantId,
      menu_id: options.menuId,
      location_id: options.locationId ?? null,
      qr_code_id: options.qrCodeId ?? null,
      entry_source: options.entrySource ?? 'unknown',
      device_class: deviceClass(),
      language: options.language ?? null,
      is_test: options.isTest ?? false,
    }
    this.writeStoredSession(now)

    this.flushTimer = setInterval(() => {
      void this.flush()
    }, FLUSH_INTERVAL_MS)
    window.addEventListener('pagehide', this.handlePageHide)
    document.addEventListener('visibilitychange', this.handleVisibilityChange)
  }

  track(event: TrackEvent): void {
    if (this.destroyed) return
    const fullEvent = {
      ...event,
      client_event_id: createId(),
      occurred_at: event.occurred_at ?? new Date().toISOString(),
    } as ClientAnalyticsEventInput
    this.queue.push(fullEvent)
    if (this.session.is_test) {
      window.dispatchEvent(new CustomEvent('xmartmenu:analytics-debug', { detail: fullEvent }))
    }
    if (this.queue.length > MAX_MEMORY_EVENTS) {
      this.queue.splice(0, this.queue.length - MAX_MEMORY_EVENTS)
    }
    this.writeStoredSession(Date.now())
    if (this.queue.length >= FLUSH_BATCH_SIZE) {
      void this.flush()
    }
  }

  trackProductImpression(productId: string, source: ClientAnalyticsEventInput['source']): void {
    if (this.impressionProductIds.has(productId)) return
    this.impressionProductIds.add(productId)
    this.track({
      event_name: 'product_impression',
      product_id: productId,
      source,
    })
  }

  async flush(useBeacon = false): Promise<void> {
    if (this.flushing || this.queue.length === 0) return
    const events = this.queue.splice(0, useBeacon ? 50 : FLUSH_BATCH_SIZE)
    const payload: AnalyticsBatchInput = { session: this.session, events }
    const body = JSON.stringify(payload)

    if (useBeacon && navigator.sendBeacon) {
      const accepted = navigator.sendBeacon(
        '/api/public/analytics',
        new Blob([body], { type: 'application/json' }),
      )
      if (!accepted) this.requeue(events)
      return
    }

    this.flushing = true
    try {
      const response = await fetch('/api/public/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      })
      if (response.status === 429 || response.status >= 500) this.requeue(events)
    } catch {
      this.requeue(events)
    } finally {
      this.flushing = false
    }
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    if (this.flushTimer) clearInterval(this.flushTimer)
    window.removeEventListener('pagehide', this.handlePageHide)
    document.removeEventListener('visibilitychange', this.handleVisibilityChange)
    void this.flush(true)
  }

  private readonly handlePageHide = () => {
    void this.flush(true)
  }

  private readonly handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      void this.flush(true)
    }
  }

  private requeue(events: ClientAnalyticsEventInput[]): void {
    if (this.destroyed) return
    this.queue = [...events, ...this.queue].slice(0, MAX_MEMORY_EVENTS)
  }

  private readStoredSession(): StoredSession | null {
    try {
      const raw = window.sessionStorage.getItem(this.storageKey)
      if (!raw) return null
      const parsed = JSON.parse(raw) as Partial<StoredSession>
      if (typeof parsed.id !== 'string' || !UUID_PATTERN.test(parsed.id) || typeof parsed.lastSeenAt !== 'number') return null
      return { id: parsed.id, lastSeenAt: parsed.lastSeenAt }
    } catch {
      return null
    }
  }

  private writeStoredSession(lastSeenAt: number): void {
    try {
      window.sessionStorage.setItem(this.storageKey, JSON.stringify({
        id: this.sessionId,
        lastSeenAt,
      } satisfies StoredSession))
    } catch {
      // Analytics storage is best-effort and must never affect menu use.
    }
  }
}
