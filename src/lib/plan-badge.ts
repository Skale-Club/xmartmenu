/**
 * Badge colours for a restaurant's plan (tenants.plan mirrors plans.slug,
 * kept in sync by the mirror_tenant_plan trigger).
 */
const BADGES: Record<string, string> = {
  menu: 'bg-zinc-100 text-zinc-600',
  orders: 'bg-blue-100 text-blue-700',
  payments: 'bg-purple-100 text-purple-700',
}

export function planBadgeClass(slug: string | null | undefined): string {
  return (slug && BADGES[slug]) || 'bg-zinc-100 text-zinc-500'
}

/** Plans that take orders (waiter or self-service), i.e. the paying tiers. */
export const ORDERING_PLANS: ReadonlySet<string> = new Set(['orders', 'payments'])
