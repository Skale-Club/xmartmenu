/**
 * Customer-menu visual tokens (owner, 2026-11-12): the visual feed's look is
 * the reference, and every customer surface — feed, dish sheet, cart,
 * checkout, "complete your order", the size picker and the AR camera's sheets —
 * takes its type and buttons from here. Change a token and every screen
 * follows. Colours stay per surface (light sheets, dark camera); shape, weight
 * and spacing come from these classes. See docs/product/design-consistency.md.
 */
import type { CSSProperties } from 'react'

export const ui = {
  /** Dish name: heavy, tight (size set per surface). */
  dishTitle: 'font-black leading-[1.02] tracking-[-0.035em]',
  /** Dish name + price sizes for DishHeading: the feed over a photo, and sheets/screens. */
  dishHeading: {
    feed: { title: 'max-w-[72%] text-[clamp(1.75rem,8vw,2.65rem)]', price: 'text-xl' },
    // The name never runs into the price: past ~60% it wraps, and the price stays on its last line.
    sheet: { title: 'max-w-[60%] text-[26px]', price: 'text-[20px]' },
  },
  /** Title of a sheet or panel that is not a dish ("Your order", "Cart"). */
  sheetTitle: 'text-[22px] font-black leading-tight tracking-[-0.025em]',
  /** Smaller title for a centred header bar. */
  barTitle: 'text-lg font-black leading-tight tracking-[-0.02em]',
  /** Small label above a group ("Ingredients", "Size", "Subtotal", "02 / 05"). */
  label: 'text-[10px] font-black uppercase tracking-[0.18em]',
  /** Prices and totals. */
  price: 'font-black tabular-nums tracking-tight',
  /** Primary action: a full pill, uppercase, wide tracking (height set per surface: h-12 menu, h-11 AR). */
  cta: 'inline-flex items-center justify-center gap-2 rounded-full px-6 text-xs font-black uppercase tracking-widest transition-[scale] hover:scale-[1.01] active:scale-[0.98]',
  /** Quiet secondary action with the same shape and type. */
  ctaQuiet: 'inline-flex items-center justify-center gap-2 rounded-full px-6 text-xs font-black uppercase tracking-widest transition active:scale-[0.98]',
} as const

/** The primary button's colours and its soft glow in the store's colour (the feed's "Order now"). */
export function ctaStyle(background: string, foreground: string): CSSProperties {
  const glow = /^#[0-9a-f]{6}$/i.test(background) ? `0 18px 45px ${background}45` : undefined
  return { backgroundColor: background, color: foreground, boxShadow: glow }
}
