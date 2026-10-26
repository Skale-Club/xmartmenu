/**
 * Pure helpers for the "Available on <plan>" hint. A screen lists what it
 * would show, marks each item with the plan feature it needs, and renders one
 * hint card for everything the plan leaves out (see PlanHintCard).
 */
import { PLAN_FOR_MODE, type PlanCeiling } from '@/lib/service-modes'

/** What a feature needs from the plan: staff ordering, guest ordering, or Stripe. */
export type PlanNeed = 'orders' | 'payments' | 'stripe'

export interface PlanHintItem {
  need: PlanNeed
  label: string
}

export interface LockedGroup {
  /** The plan that unlocks these features. */
  planName: string
  labels: string[]
}

/** The cheapest plan that includes the feature. */
export function planNameForNeed(need: PlanNeed): string {
  return need === 'orders' ? PLAN_FOR_MODE.waiter : PLAN_FOR_MODE.self_service
}

export function isIncluded(plan: Pick<PlanCeiling, PlanNeed>, need: PlanNeed): boolean {
  return plan[need] === true
}

/** Locked items grouped by the plan that unlocks them, cheapest plan first. */
export function lockedGroups(plan: Pick<PlanCeiling, PlanNeed>, items: readonly PlanHintItem[]): LockedGroup[] {
  const byPlan = new Map<string, string[]>()
  for (const item of items) {
    if (isIncluded(plan, item.need)) continue
    const planName = planNameForNeed(item.need)
    byPlan.set(planName, [...(byPlan.get(planName) ?? []), item.label])
  }
  return [PLAN_FOR_MODE.waiter, PLAN_FOR_MODE.self_service]
    .filter(planName => byPlan.has(planName))
    .map(planName => ({ planName, labels: byPlan.get(planName) ?? [] }))
}

/**
 * The hint for one feature, or null when the plan includes it:
 * `planHint(capabilities, 'payments', 'Order suggestions')`.
 */
export function planHint(
  capabilities: { plan: Pick<PlanCeiling, PlanNeed> },
  need: PlanNeed,
  label?: string,
): LockedGroup | null {
  return lockedGroups(capabilities.plan, [{ need, label: label ?? '' }])[0] ?? null
}

/** A hint for a feature the caller already knows is locked (the plan check happened server-side). */
export function lockedGroup(need: PlanNeed, label: string): LockedGroup {
  return { planName: planNameForNeed(need), labels: [label] }
}

/** "Available on Menu + Orders: Tables, KDS timers. Available on Menu + Payments: Tips." */
export function describeLocked(groups: readonly LockedGroup[]): string {
  return groups
    .map(group => {
      const labels = group.labels.filter(Boolean).join(', ')
      return labels ? `Available on ${group.planName}: ${labels}.` : `Available on ${group.planName}.`
    })
    .join(' ')
}
