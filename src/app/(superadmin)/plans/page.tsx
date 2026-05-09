import { createClient } from '@/lib/supabase/server'
import PlansClient from './PlansClient'

export const dynamic = 'force-dynamic'

async function getPlans() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('plans')
    .select('*')
    .order('sort_order', { ascending: true })

  if (error) {
    console.error('Failed to fetch plans:', error)
    return []
  }

  return data || []
}

export default async function PlansPage() {
  const plans = await getPlans()

  return <PlansClient plans={plans} />
}