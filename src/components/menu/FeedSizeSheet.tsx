'use client'

import { useState } from 'react'
import { Check, X } from 'lucide-react'
import ModalPortal from '@/components/ui/ModalPortal'
import { computePrimaryForeground } from '@/lib/color-utils'
import { formatMoney, getMenuCopy } from './menu-i18n'
import type { FeedSize } from './feed-sizes'

/**
 * Half-height sheet that rises from the bottom of the feed: pick a size, then
 * confirm. The confirm button is the one that puts the dish in the order.
 */
export default function FeedSizeSheet({
  productName,
  sizes,
  currency,
  lang,
  primaryColor,
  onClose,
  onConfirm,
}: {
  productName: string
  sizes: FeedSize[]
  currency: string
  lang: string
  primaryColor: string
  onClose: () => void
  onConfirm: (size: FeedSize) => void
}) {
  const copy = getMenuCopy(lang)
  const [selectedId, setSelectedId] = useState(sizes[0]?.id ?? '')
  const selected = sizes.find(size => size.id === selectedId) ?? sizes[0]
  if (!selected) return null
  const onPrimary = computePrimaryForeground(primaryColor)

  return (
    <ModalPortal onClose={onClose}>
      <div className="fixed inset-0 z-[70] flex items-end" role="dialog" aria-modal="true" aria-label={copy.selectOption}>
        <button type="button" aria-label={copy.close} onClick={onClose} className="absolute inset-0 bg-zinc-950/55 backdrop-blur-[2px]" />
        <div className="relative max-h-[60dvh] w-full overflow-y-auto rounded-t-3xl bg-white px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-zinc-900 shadow-float">
          <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-zinc-300" aria-hidden="true" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-zinc-500">{copy.selectOption}</p>
              <h2 className="mt-0.5 truncate text-lg font-semibold tracking-tight">{productName}</h2>
            </div>
            <button type="button" onClick={onClose} aria-label={copy.close} className="flex size-10 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-100">
              <X className="size-5" />
            </button>
          </div>

          <div role="radiogroup" aria-label={copy.selectOption} className="mt-3 divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200">
            {sizes.map(size => {
              const active = size.id === selected.id
              return (
                <button
                  key={size.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setSelectedId(size.id)}
                  className="flex min-h-14 w-full items-center gap-3 px-4 text-left transition-colors hover:bg-zinc-50"
                >
                  <span
                    className="flex size-6 shrink-0 items-center justify-center rounded-full border-2"
                    style={active ? { backgroundColor: primaryColor, borderColor: primaryColor, color: onPrimary } : { borderColor: '#d4d4d8' }}
                  >
                    {active ? <Check className="size-3.5" strokeWidth={3} aria-hidden="true" /> : null}
                  </span>
                  <span className="min-w-0 flex-1 text-[15px] font-medium">{size.label}</span>
                  <span className="shrink-0 text-[15px] font-semibold tabular-nums text-zinc-700">{formatMoney(size.price, currency, lang)}</span>
                </button>
              )
            })}
          </div>

          <button
            type="button"
            onClick={() => onConfirm(selected)}
            style={{ backgroundColor: primaryColor, color: onPrimary }}
            className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-2xl px-4 text-base font-semibold shadow-float transition-[opacity,scale] hover:opacity-95 active:scale-[0.98]"
          >
            <span className="truncate">{copy.orderNow}</span>
            <span aria-hidden="true" className="opacity-70">·</span>
            <span className="tabular-nums">{formatMoney(selected.price, currency, lang)}</span>
          </button>
        </div>
      </div>
    </ModalPortal>
  )
}
