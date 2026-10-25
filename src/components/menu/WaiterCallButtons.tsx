'use client'

import { useState } from 'react'
import { BellRing, CheckCircle2, Loader2, Receipt } from 'lucide-react'
import type { GuestCopy } from './guest-copy'
import type { WaiterCallReason } from '@/lib/waiter-calls'

/**
 * "Call waiter" / "Ask for the bill" on a table's menu link. The staff get it
 * live in the waiter app and on the orders screen.
 */
export default function WaiterCallButtons({ slug, tableId, copy, primaryColor }: {
  slug: string
  tableId: string
  copy: GuestCopy
  primaryColor: string
}) {
  const [busy, setBusy] = useState<WaiterCallReason | null>(null)
  const [sent, setSent] = useState<WaiterCallReason | null>(null)
  const [failed, setFailed] = useState(false)

  async function call(reason: WaiterCallReason) {
    setBusy(reason)
    setFailed(false)
    try {
      const res = await fetch(`/api/public/waiter-call/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table_id: tableId, reason }),
      })
      if (!res.ok && res.status !== 429) throw new Error(String(res.status))
      setSent(reason)
    } catch {
      setFailed(true)
    }
    setBusy(null)
  }

  const button = 'inline-flex min-h-10 items-center gap-2 rounded-full bg-white px-3.5 text-[14px] font-semibold text-zinc-900 shadow-card transition-[scale,opacity] duration-150 active:scale-96 disabled:opacity-60'

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => void call('waiter')} disabled={busy !== null} className={button}>
        {busy === 'waiter' ? <Loader2 className="size-4 animate-spin" /> : <BellRing className="size-4" style={{ color: primaryColor }} />}
        {copy.callWaiter}
      </button>
      <button type="button" onClick={() => void call('bill')} disabled={busy !== null} className={button}>
        {busy === 'bill' ? <Loader2 className="size-4 animate-spin" /> : <Receipt className="size-4" style={{ color: primaryColor }} />}
        {copy.askBill}
      </button>
      <p role="status" aria-live="polite" className="w-full text-[13px] font-medium">
        {sent && !failed && (
          <span className="inline-flex items-center gap-1.5 text-emerald-700">
            <CheckCircle2 className="size-4" />{sent === 'bill' ? copy.billRequested : copy.waiterCalled}
          </span>
        )}
        {failed && <span className="text-red-600">{copy.callFailed}</span>}
      </p>
    </div>
  )
}
