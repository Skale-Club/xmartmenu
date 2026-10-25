import { redirect } from 'next/navigation'
import { assertSuperadmin } from '@/lib/superadmin-auth'
import AiBillingClient from './AiBillingClient'

export const dynamic = 'force-dynamic'

/**
 * AI & billing (superadmin): the global OpenRouter key every client uses by
 * default and as fallback, the default billing mode and margin, and how each
 * client is set up and what they used this month.
 */
export default async function AiBillingPage() {
  if (!(await assertSuperadmin())) redirect('/overview')
  return <AiBillingClient />
}
