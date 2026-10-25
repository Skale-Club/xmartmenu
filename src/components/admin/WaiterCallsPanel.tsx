'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BellRing, Check, Footprints, Receipt } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { activeCalls, CALL_REASON_LABELS, upsertCall, waitingFor, type WaiterCall } from '@/lib/waiter-calls'

// A call is "new" for each tap: id + when it was last called + status.
const keyOf = (c: WaiterCall) => `${c.id}:${c.last_called_at ?? c.created_at}:${c.status}`

/**
 * Live list of tables calling a waiter or asking for the bill (waiter app and
 * orders screen). New calls beep and vibrate; staff mark "On my way" / "Done".
 * Realtime first, with a slow poll as a safety net.
 */
export default function WaiterCallsPanel({ tenantId, compact = false }: { tenantId: string; compact?: boolean }) {
  const supabase = useMemo(() => createClient(), [])
  const [calls, setCalls] = useState<WaiterCall[]>([])
  const [now, setNow] = useState(() => Date.now())
  const seen = useRef<Set<string>>(new Set())
  const ready = useRef(false)

  const alert = useCallback(() => {
    try {
      navigator.vibrate?.([200, 100, 200])
      const ctx = new AudioContext()
      for (const [i, freq] of [988, 1319].entries()) {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.frequency.value = freq
        const t = ctx.currentTime + i * 0.18
        gain.gain.setValueAtTime(0.25, t)
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15)
        osc.start(t)
        osc.stop(t + 0.15)
      }
    } catch { /* no audio until the page has been touched */ }
  }, [])

  const apply = useCallback((next: WaiterCall[]) => {
    const fresh = next.some(c => c.status === 'open' && !seen.current.has(keyOf(c)))
    for (const c of next) seen.current.add(keyOf(c))
    if (fresh && ready.current) alert()
    ready.current = true
    setCalls(activeCalls(next))
  }, [alert])

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/waiter-calls').catch(() => null)
    if (res?.ok) apply(((await res.json()) as { calls: WaiterCall[] }).calls)
  }, [apply])

  useEffect(() => {
    void load()
    const poll = setInterval(() => void load(), 30_000)
    const tick = setInterval(() => setNow(Date.now()), 30_000)
    const channel = supabase
      .channel(`waiter-calls-${tenantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'waiter_calls', filter: `tenant_id=eq.${tenantId}` }, (payload) => {
        const row = payload.new as WaiterCall | undefined
        if (!row?.id) return
        const key = keyOf(row)
        if (row.status === 'open' && !seen.current.has(key)) alert()
        seen.current.add(key)
        setCalls(prev => activeCalls(upsertCall(prev, row)))
      })
      .subscribe()
    return () => {
      clearInterval(poll)
      clearInterval(tick)
      supabase.removeChannel(channel)
    }
  }, [supabase, tenantId, load, alert])

  async function update(call: WaiterCall, status: 'acknowledged' | 'done') {
    setCalls(prev => activeCalls(prev.map(c => (c.id === call.id ? { ...c, status } : c))))
    const res = await fetch(`/api/admin/waiter-calls/${call.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }).catch(() => null)
    if (!res?.ok) void load()
  }

  if (!calls.length) return null

  return (
    <section aria-label="Tables calling" className={`rounded-2xl border-2 border-amber-300 bg-amber-50 ${compact ? 'p-3' : 'p-4'} space-y-2`}>
      <p className="flex items-center gap-2 text-sm font-bold text-amber-900">
        <BellRing className="size-4 animate-pulse" />
        {calls.length === 1 ? '1 table is calling' : `${calls.length} tables are calling`}
      </p>
      <ul className="space-y-2">
        {calls.map(call => (
          <li key={call.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-white px-3 py-2 shadow-sm">
            {call.reason === 'bill' ? <Receipt className="size-4 text-amber-700" /> : <BellRing className="size-4 text-amber-700" />}
            <span className="font-bold text-zinc-900">{call.table_name}</span>
            <span className="text-sm text-zinc-600">{CALL_REASON_LABELS[call.reason]}</span>
            <span className="text-xs text-zinc-400">· {waitingFor(call.created_at, now)}</span>
            <span className="ml-auto flex gap-2">
              {call.status === 'open' ? (
                <button type="button" onClick={() => void update(call, 'acknowledged')} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 text-xs font-bold text-white">
                  <Footprints className="size-3.5" />On my way
                </button>
              ) : (
                <span className="inline-flex min-h-9 items-center px-2 text-xs font-semibold text-emerald-700">On the way</span>
              )}
              <button type="button" onClick={() => void update(call, 'done')} aria-label={`Done: ${call.table_name}`} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-zinc-100 px-3 text-xs font-bold text-zinc-700">
                <Check className="size-3.5" />Done
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
