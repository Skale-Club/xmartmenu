import { withApi } from '@/lib/observability/with-api'
import { ownedMenuStagingHttp } from '@/lib/admin/owned-menu-staging-http'

interface Props { params: Promise<{ id: string }> }

// Menu staging: create a copy, publish (swap) it, or rotate its preview link.
// See src/lib/admin/owned-menu-staging-http.ts and docs/product/menu-staging.md.
async function handlePOST(request: Request, { params }: Props) {
  const { id } = await params
  return ownedMenuStagingHttp(request, id)
}

export const POST = withApi('POST /api/admin/menus/[id]/staging', handlePOST)
