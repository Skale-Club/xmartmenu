export const dynamic = 'force-dynamic'

import { createServiceClient } from '@/lib/supabase/server'
import { loadLaunchChecklist } from '@/lib/admin/launch-checklist-data'
import LaunchChecklistClient from './LaunchChecklistClient'

// Super-admin → Clients → Launch checklist. A static segment under /tenants so
// it can never collide with a restaurant slug (a top-level /launch would have
// to be reserved). The (superadmin) layout already enforces the role.
export default async function LaunchChecklistPage({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  const [{ tenant }, data] = await Promise.all([searchParams, loadLaunchChecklist(createServiceClient())])
  return <LaunchChecklistClient initial={data} initialOpenTenantId={tenant ?? null} />
}
