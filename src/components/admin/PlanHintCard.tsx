import Link from 'next/link'
import { Lock } from 'lucide-react'
import { describeLocked, type LockedGroup } from './plan-hint'

/**
 * The one hint a screen shows for everything its plan leaves out: a small
 * card with a lock and a link to the subscription page. Renders nothing when
 * nothing is locked, so callers can always mount it.
 */
export default function PlanHintCard({ groups, className = '' }: { groups: readonly LockedGroup[]; className?: string }) {
  if (groups.length === 0) return null
  return (
    <div className={`flex items-start gap-3 rounded-[1.25rem] border border-zinc-200 bg-zinc-50 px-5 py-4 ${className}`}>
      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-200">
        <Lock className="size-4 text-zinc-600" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold leading-relaxed text-zinc-700">{describeLocked(groups)}</p>
        <Link href="/settings/subscription" className="mt-1 inline-flex text-[10px] font-black uppercase tracking-widest text-primary hover:underline">
          See plans
        </Link>
      </div>
    </div>
  )
}
