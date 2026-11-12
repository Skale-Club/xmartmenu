import { notFound } from 'next/navigation'
import { ownedAuthSelected } from '@/lib/auth/owned-principal'
import { ownedAccessRequests } from '@/lib/access-requests/admin-runtime'
import { isMissingAccessRequestsTable } from '@/lib/access-requests/store'
import { ownedTenantDirectory } from '@/lib/data/tenant-administration-runtime'
import AccessRequestsClient from './AccessRequestsClient'

export const dynamic = 'force-dynamic'

export default async function AccessRequestsPage() {
  if (!ownedAuthSelected()) notFound()
  const [requests, directory] = await Promise.all([
    ownedAccessRequests().catch(error => { if (isMissingAccessRequestsTable(error)) return null; throw error }),
    ownedTenantDirectory(),
  ])
  const restaurants = directory.clients.filter(client => client.id).map(client => ({ id: String(client.id), name: client.name ?? client.slug ?? String(client.id), slug: client.slug }))
  return <AccessRequestsClient initialRequests={requests ?? []} unavailable={requests === null} restaurants={restaurants} plans={directory.plans.filter(plan => plan.is_active)} />
}
