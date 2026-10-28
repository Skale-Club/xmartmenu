import type { DishDetail } from '@/lib/public-dish-details'

/** Ingredient and allergen lines, shown right after a dish's description. */
export default function DishDetails({ details, tone = 'light' }: { details: DishDetail[]; tone?: 'light' | 'dark' }) {
  if (details.length === 0) return null
  const dark = tone === 'dark'
  return (
    <dl className={`mt-3 space-y-2 text-[13px] leading-relaxed ${dark ? 'text-white/75' : 'text-zinc-500'}`}>
      {details.map(detail => (
        <div key={detail.label}>
          <dt className={`text-[10px] font-black uppercase tracking-widest ${dark ? 'text-white/55' : 'text-zinc-400'}`}>{detail.label}</dt>
          <dd>{detail.text}</dd>
        </div>
      ))}
    </dl>
  )
}
