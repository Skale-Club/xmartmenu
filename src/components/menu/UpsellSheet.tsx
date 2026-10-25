'use client'

import Image from 'next/image'
import { Check, Plus, UtensilsCrossed, X } from 'lucide-react'
import type { Product } from '@/types/database'
import ModalPortal from '@/components/ui/ModalPortal'
import { computePrimaryForeground } from '@/lib/color-utils'
import { fill, formatMoney, getMenuCopy } from './menu-i18n'
import { getProductImages } from './menu-utils'
import type { UpsellStep } from './upsell'

/**
 * "Complete your order": one step at a time (goes well with…, a side, a drink,
 * a dessert). Dishes without required choices go straight into the cart;
 * the others open their details and come back here.
 */
export default function UpsellSheet({
  steps,
  stepIndex,
  triggerName,
  addedIds,
  lang,
  currency,
  primaryColor,
  canQuickAdd,
  onAdd,
  onChoose,
  onNext,
  onClose,
}: {
  steps: UpsellStep[]
  stepIndex: number
  /** The dish that started the sequence, in the guest's language. */
  triggerName: string
  /** Suggestions already taken in this sequence. */
  addedIds: ReadonlySet<string>
  lang: string
  currency: string
  primaryColor: string
  canQuickAdd: (product: Product) => boolean
  onAdd: (product: Product) => void
  onChoose: (product: Product) => void
  /** Next step, or the end after the last one. */
  onNext: () => void
  onClose: () => void
}) {
  const copy = getMenuCopy(lang)
  const step = steps[stepIndex]
  if (!step) return null
  const onPrimary = computePrimaryForeground(primaryColor)
  const isLast = stepIndex === steps.length - 1
  const tookFromStep = step.products.some(p => addedIds.has(p.id))
  const heading = {
    pairs: fill(copy.upsellPairs, { name: triggerName }),
    side: copy.upsellSide,
    drink: copy.upsellDrink,
    dessert: copy.upsellDessert,
  }[step.kind]

  return (
    <ModalPortal onClose={onClose}>
      <div className="menu-root fixed inset-0 z-[60] flex items-end justify-center bg-zinc-950/40 backdrop-blur-[2px] sm:items-center sm:p-4" onClick={onClose}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="upsell-heading"
          className="relative flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-menu shadow-float sm:max-h-[calc(100dvh-2rem)] sm:max-w-md sm:rounded-3xl"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex shrink-0 items-start gap-3 border-b border-zinc-100 bg-white px-5 pt-4 pb-3">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-[13px] font-medium text-emerald-700">
                <Check className="size-4" aria-hidden="true" />
                <span className="truncate">{fill(copy.upsellAdded, { name: triggerName })}</span>
              </p>
              <p className="mt-0.5 text-[12px] font-semibold uppercase tracking-wide text-zinc-400">
                {copy.upsellTitle}
                {steps.length > 1 && <> · {fill(copy.upsellStep, { current: stepIndex + 1, total: steps.length })}</>}
              </p>
            </div>
            <button type="button" onClick={onClose} className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900" aria-label={copy.close}>
              <X className="size-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain px-5 pt-4 pb-2">
            <h2 id="upsell-heading" className="text-[22px] font-bold leading-tight tracking-tight text-zinc-900">{heading}</h2>
            {steps.length > 1 && (
              <div className="mt-3 flex gap-1" aria-hidden="true">
                {steps.map((_, i) => (
                  <span key={i} className="h-1 flex-1 rounded-full" style={{ backgroundColor: i <= stepIndex ? primaryColor : '#e4e4e7' }} />
                ))}
              </div>
            )}
            <ul className="mt-4 space-y-2.5">
              {step.products.map(product => {
                const image = getProductImages(product)[0]
                const added = addedIds.has(product.id)
                const quick = canQuickAdd(product)
                return (
                  <li key={product.id} className="flex items-center gap-3 rounded-2xl bg-white p-2.5 shadow-card">
                    <span className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-zinc-100">
                      {image
                        ? <Image src={image} alt="" fill sizes="64px" className="object-cover" />
                        : <span className="flex size-full items-center justify-center text-zinc-300"><UtensilsCrossed className="size-6" /></span>}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-[15px] font-semibold leading-snug text-zinc-900">{product.name}</span>
                      <span className="mt-0.5 block text-[14px] font-medium tabular-nums text-zinc-600">{formatMoney(product.price, currency, lang)}</span>
                    </span>
                    {added ? (
                      <span className="flex min-h-10 shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-3 text-[13px] font-semibold text-emerald-700">
                        <Check className="size-4" aria-hidden="true" />{copy.upsellInOrder}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => (quick ? onAdd(product) : onChoose(product))}
                        aria-label={quick ? fill(copy.addNamed, { name: product.name }) : `${copy.upsellChoose} ${product.name}`}
                        className="flex min-h-10 shrink-0 items-center gap-1 rounded-full px-3.5 text-[13px] font-semibold transition-[scale] active:scale-95"
                        style={{ backgroundColor: primaryColor, color: onPrimary }}
                      >
                        {quick ? <><Plus className="size-4" aria-hidden="true" />{copy.add}</> : copy.upsellChoose}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>

          <div className="shrink-0 border-t border-zinc-100 bg-white px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={onNext}
              className={`flex h-12 w-full items-center justify-center rounded-2xl text-[15px] font-semibold transition-[scale] active:scale-[0.98] ${tookFromStep ? '' : 'bg-zinc-100 text-zinc-800 hover:bg-zinc-200'}`}
              style={tookFromStep ? { backgroundColor: primaryColor, color: onPrimary } : undefined}
            >
              {tookFromStep ? (isLast ? copy.upsellDone : copy.upsellContinue) : copy.upsellSkip}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
