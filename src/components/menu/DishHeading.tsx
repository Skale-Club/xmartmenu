/**
 * The dish's name and price row, shared by every customer surface (owner,
 * 2026-11-12): the visual feed's layout is the reference — name on the left,
 * price on the right on the same row, the price never inside a button. Change
 * it here and the feed, the dish screen and the 3D camera's sheet follow.
 * Colours come from the caller (white over photos, dark on light sheets).
 */
import type { CSSProperties, ReactNode } from 'react'
import { ui } from './menu-ui'

export type DishHeadingSize = keyof typeof ui.dishHeading

export default function DishHeading({ name, price, size = 'sheet', as: Tag = 'h2', className = '', titleClassName = '', priceClassName = '', priceStyle }: {
  name: ReactNode
  /** Price text, or a block (e.g. price plus a struck-through original). Omit to show the name alone. */
  price?: ReactNode
  size?: DishHeadingSize
  as?: 'h2' | 'h3'
  className?: string
  titleClassName?: string
  priceClassName?: string
  priceStyle?: CSSProperties
}) {
  const metrics = ui.dishHeading[size]
  return (
    <div className={`flex items-end justify-between gap-4 ${className}`}>
      <Tag className={`min-w-0 ${metrics.title} ${ui.dishTitle} ${titleClassName}`}>{name}</Tag>
      {price != null && price !== '' && (
        <div className={`shrink-0 text-right ${metrics.price} ${ui.price} ${priceClassName}`} style={priceStyle}>{price}</div>
      )}
    </div>
  )
}
