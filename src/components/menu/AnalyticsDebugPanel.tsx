'use client'

import { useEffect, useState } from 'react'
import { Activity, X } from 'lucide-react'
import type { ClientAnalyticsEventInput } from '@/lib/analytics/contracts'

export default function AnalyticsDebugPanel({ sessionId, onClose }: { sessionId: string | null; onClose: () => void }) {
  const [events, setEvents] = useState<ClientAnalyticsEventInput[]>([])

  useEffect(() => {
    const listener = (rawEvent: Event) => {
      const event = rawEvent as CustomEvent<ClientAnalyticsEventInput>
      setEvents(current => [event.detail, ...current].slice(0, 20))
    }
    window.addEventListener('xmartmenu:analytics-debug', listener)
    return () => window.removeEventListener('xmartmenu:analytics-debug', listener)
  }, [])

  return (
    <aside className="fixed bottom-4 left-4 z-[80] w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-emerald-400/30 bg-zinc-950 text-white shadow-2xl" aria-label="Analytics event inspector">
      <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2"><Activity className="size-4 text-emerald-400" /><div><p className="text-xs font-black uppercase tracking-widest">Test event inspector</p><p className="max-w-72 truncate font-mono text-[9px] text-zinc-500">{sessionId ?? 'Starting session…'}</p></div></div>
        <button type="button" onClick={onClose} aria-label="Close event inspector" className="flex size-9 items-center justify-center rounded-full hover:bg-white/10"><X className="size-4" /></button>
      </header>
      <div className="max-h-64 overflow-y-auto p-2">
        {events.length > 0 ? events.map(event => (
          <div key={event.client_event_id} className="mb-1 rounded-xl bg-white/5 px-3 py-2 font-mono text-[10px]">
            <div className="flex justify-between gap-3"><span className="font-bold text-emerald-300">{event.event_name}</span><span className="text-zinc-600">{new Date(event.occurred_at).toLocaleTimeString()}</span></div>
            <p className="mt-1 truncate text-zinc-400">{[event.source, event.product_id, event.duration_ms ? `${event.duration_ms}ms` : null].filter(Boolean).join(' · ') || 'session event'}</p>
          </div>
        )) : <p className="p-6 text-center text-xs text-zinc-500">Interact with the menu to inspect validated events.</p>}
      </div>
      <p className="border-t border-white/10 px-4 py-2 text-[9px] font-bold uppercase tracking-widest text-zinc-600">Test sessions are excluded from dashboard reporting</p>
    </aside>
  )
}
